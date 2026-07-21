import Busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';
import { StorageFactory } from '../../infrastructure/storage/StorageFactory.js';
import { PrismaFileRepository } from '../../infrastructure/persistence/PrismaFileRepository.js';
import { StoragePath } from '../../domain/value-objects/StoragePath.js';
import { MimeTypeGuard } from '../../domain/value-objects/MimeTypeGuard.js';
import { DeduplicationService } from '../../application/services/DeduplicationService.js';
import { HashAndPeekTransform, getCachedSignedUrl } from '../../application/services/UploadHelpers.js';
import { KafkaPublisher } from '../../infrastructure/queue/KafkaPublisher.js';
import { validateUploadFields } from '../validators/upload.validator.js';
import { validateListQuery } from '../validators/query.validator.js';
import { NotFoundError, ValidationError, AppError } from '../../../../../shared/common/errors.js';
import { metrics } from '../../infrastructure/metrics/metrics.js';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');
const fileRepo = new PrismaFileRepository();

function serializeFile(file) {
  return {
    id: file.id,
    service: file.service,
    module: file.module,
    ownerId: file.ownerId,
    referenceId: file.referenceId || null,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: Number(file.size),
    checksum: file.checksum,
    status: file.status,
    compressed: file.compressed,
    compressionType: file.compressionType || null,
    thumbnails: file.thumbnails || null,
    metadata: file.metadata || null,
    versionOf: file.versionOf || null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    url: `/api/v1/files/${file.id}/view`,
    downloadUrl: `/api/v1/files/${file.id}/download`,
  };
}

/**
 * POST /files — single multipart upload.
 * Creates a PENDING record; workers advance the lifecycle to AVAILABLE.
 */
export async function upload(req, res, next) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function finish(err) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    }

    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: config.upload.maxSizeBytes,
        files: 1,
        fields: 20,
      },
    });

    const fields = {};
    let fileUploadPromise = null;

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (fieldname, fileStream, info) => {
      const { filename = 'unnamed', mimeType: rawMime = 'application/octet-stream' } = info;

      let validatedFields;
      try {
        validatedFields = validateUploadFields(fields);
      } catch (err) {
        fileStream.resume();
        return finish(err);
      }

      if (MimeTypeGuard.isBlocked(filename)) {
        fileStream.resume();
        return finish(new ValidationError(`File type is not allowed: "${filename}"`));
      }

      const fileId = uuidv4();
      const measuring = new HashAndPeekTransform();
      let sizeLimitHit = false;

      fileStream.on('limit', () => {
        sizeLimitHit = true;
        measuring.destroy(
          new ValidationError(
            `File exceeds the maximum allowed size of ${Math.round(config.upload.maxSizeBytes / 1024 / 1024)} MB`
          )
        );
      });

      fileStream.on('error', (err) => measuring.destroy(err));
      fileStream.pipe(measuring);

      const storage = StorageFactory.getInstance();
      const provisionalPath = StoragePath.build({
        service: validatedFields.service,
        module: validatedFields.module,
        fileId,
      });

      // Stream to storage first, then create DB record (with magic-byte MIME + optional dedup)
      fileUploadPromise = storage
        .upload(provisionalPath, measuring, MimeTypeGuard.normalize(rawMime))
        .then(async () => {
          if (sizeLimitHit) throw new ValidationError('File too large');

          const peek = measuring.getPeekBuffer();
          const mimeType = await MimeTypeGuard.detectFromBuffer(peek, rawMime);
          const checksum = measuring.getChecksum();
          const byteCount = measuring.byteCount;

          const duplicate = await DeduplicationService.findDuplicate(
            checksum,
            validatedFields.service
          );

          let storagePath = provisionalPath;
          let storageProvider = config.storage.provider;

          if (duplicate) {
            // Reuse existing bytes; delete the provisional upload
            await storage.delete(provisionalPath).catch(() => {});
            storagePath = duplicate.storagePath;
            storageProvider = duplicate.storageProvider;
          }

          const policy = await fileRepo.getRetentionPolicy(validatedFields.service);
          const retentionDays =
            policy !== null ? policy.retentionDays : config.retention.defaultSoftDeleteDays;

          const file = await fileRepo.create({
            id: fileId,
            service: validatedFields.service,
            module: validatedFields.module,
            ownerId: req.user.id,
            referenceId: validatedFields.referenceId || null,
            originalName: filename,
            storedName: `${fileId}.bin`,
            mimeType,
            size: BigInt(byteCount),
            checksum,
            storagePath,
            storageProvider,
            compressed: false,
            compressRequested: Boolean(validatedFields.compress),
            status: 'PENDING',
            retentionDays,
            versionOf: validatedFields.versionOf || null,
          });

          metrics.inc('fms_uploads_total', { status: 'pending' });
          await KafkaPublisher.audit('FILE_UPLOADED_PENDING', file, req.user.id);

          logger.info('File uploaded (PENDING)', {
            fileId: file.id,
            service: file.service,
            module: file.module,
            size: byteCount,
            mimeType,
            deduped: Boolean(duplicate),
          });

          return file;
        });
    });

    bb.on('error', (err) => finish(err));

    bb.on('finish', async () => {
      if (!fileUploadPromise) {
        return finish(
          new ValidationError(
            'No file field found in the request. Use multipart/form-data with a "file" field.'
          )
        );
      }
      try {
        const file = await fileUploadPromise;
        res.status(201).json(serializeFile(file));
        finish();
      } catch (err) {
        metrics.inc('fms_upload_errors_total');
        finish(err);
      }
    });

    req.pipe(bb);
  }).catch(next);
}

/**
 * POST /files/batch
 */
export async function uploadBatch(req, res, next) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function finish(err) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    }

    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: config.upload.maxSizeBytes,
        files: 100,
        fields: 20,
      },
    });

    const fields = {};
    const uploadPromises = [];
    const results = { uploaded: [], failed: [] };

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (fieldname, fileStream, info) => {
      const { filename = 'unnamed', mimeType: rawMime = 'application/octet-stream' } = info;

      if (MimeTypeGuard.isBlocked(filename)) {
        fileStream.resume();
        results.failed.push({ originalName: filename, reason: 'File type not allowed' });
        return;
      }

      let validatedFields;
      try {
        validatedFields = validateUploadFields(fields);
      } catch (err) {
        fileStream.resume();
        results.failed.push({ originalName: filename, reason: err.message });
        return;
      }

      const fileId = uuidv4();
      const measuring = new HashAndPeekTransform();
      const provisionalPath = StoragePath.build({
        service: validatedFields.service,
        module: validatedFields.module,
        fileId,
      });

      fileStream.on('error', (err) => measuring.destroy(err));
      fileStream.pipe(measuring);

      const storage = StorageFactory.getInstance();

      const promise = storage
        .upload(provisionalPath, measuring, MimeTypeGuard.normalize(rawMime))
        .then(async () => {
          const peek = measuring.getPeekBuffer();
          const mimeType = await MimeTypeGuard.detectFromBuffer(peek, rawMime);
          const checksum = measuring.getChecksum();
          const byteCount = measuring.byteCount;

          const duplicate = await DeduplicationService.findDuplicate(
            checksum,
            validatedFields.service
          );

          let storagePath = provisionalPath;
          let storageProvider = config.storage.provider;

          if (duplicate) {
            await storage.delete(provisionalPath).catch(() => {});
            storagePath = duplicate.storagePath;
            storageProvider = duplicate.storageProvider;
          }

          const policy = await fileRepo.getRetentionPolicy(validatedFields.service);
          const retentionDays =
            policy !== null ? policy.retentionDays : config.retention.defaultSoftDeleteDays;

          const file = await fileRepo.create({
            id: fileId,
            service: validatedFields.service,
            module: validatedFields.module,
            ownerId: req.user.id,
            referenceId: validatedFields.referenceId || null,
            originalName: filename,
            storedName: `${fileId}.bin`,
            mimeType,
            size: BigInt(byteCount),
            checksum,
            storagePath,
            storageProvider,
            compressed: false,
            compressRequested: Boolean(validatedFields.compress),
            status: 'PENDING',
            retentionDays,
            versionOf: validatedFields.versionOf || null,
          });

          results.uploaded.push(serializeFile(file));
          metrics.inc('fms_uploads_total', { status: 'pending' });
          logger.info('Batch file uploaded (PENDING)', { fileId: file.id, originalName: filename });
        })
        .catch((err) => {
          results.failed.push({ originalName: filename, reason: err.message });
          metrics.inc('fms_upload_errors_total');
          logger.warn('Batch file upload failed', { originalName: filename, error: err.message });
        });

      uploadPromises.push(promise);
    });

    bb.on('error', finish);

    bb.on('finish', async () => {
      try {
        await Promise.all(uploadPromises);
        res.status(201).json(results);
        finish();
      } catch (err) {
        finish(err);
      }
    });

    req.pipe(bb);
  }).catch(next);
}

export async function getFile(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');
    res.json(serializeFile(file));
  } catch (err) {
    next(err);
  }
}

export async function listFiles(req, res, next) {
  try {
    const query = validateListQuery(req.query);
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const isAdmin =
      permissions.includes('file:admin') ||
      permissions.includes('file:*') ||
      permissions.includes('*') ||
      roles.includes('file.admin') ||
      roles.includes('system_admin');

    const crossService = Boolean(query.crossService) && isAdmin;

    // Non-admin listing is always scoped — prefer explicit service filter;
    // if missing, do not leak cross-service results.
    const result = await fileRepo.list({
      ...query,
      crossService,
    });

    res.json({
      data: result.data.map(serializeFile),
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteFile(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');

    let scheduledDeleteAt = null;
    if (file.retentionDays !== null && file.retentionDays !== undefined) {
      scheduledDeleteAt = new Date(
        Date.now() + file.retentionDays * 24 * 60 * 60 * 1000
      );
    }

    await fileRepo.softDelete(file.id, { scheduledDeleteAt });
    await KafkaPublisher.fileDeleted(file, req.user.id);
    await KafkaPublisher.audit('FILE_DELETED', file, req.user.id);

    logger.info('File soft-deleted', {
      fileId: file.id,
      service: file.service,
      scheduledDeleteAt,
      retentionDays: file.retentionDays,
    });

    res.json({
      id: file.id,
      deleted: true,
      willBeRemovedAt: scheduledDeleteAt,
      message: scheduledDeleteAt
        ? `File will be permanently removed on ${scheduledDeleteAt.toISOString()}`
        : 'File is marked deleted but will never be permanently removed (retention policy: keep forever)',
    });
  } catch (err) {
    next(err);
  }
}

export async function downloadFile(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');
    if (file.status !== 'AVAILABLE') {
      throw new AppError(`File is not available for download (status: ${file.status})`, 409, 'FILE_NOT_AVAILABLE');
    }

    const storage = StorageFactory.getInstance();
    const stream = await storage.download(file.storagePath);
    const encodedName = encodeURIComponent(file.originalName);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Length', Number(file.size));
    res.setHeader('X-Checksum', file.checksum);
    res.setHeader('Cache-Control', 'private, no-cache');

    stream.on('error', (err) => {
      logger.error('Stream error during download', { fileId: file.id, error: err.message });
      if (!res.headersSent) next(err);
      else res.destroy(err);
    });

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

export async function viewFile(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');
    if (file.status !== 'AVAILABLE') {
      throw new AppError(`File is not available for viewing (status: ${file.status})`, 409, 'FILE_NOT_AVAILABLE');
    }

    const storage = StorageFactory.getInstance();
    const stream = await storage.download(file.storagePath);
    const encodedName = encodeURIComponent(file.originalName);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Length', Number(file.size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    stream.on('error', (err) => {
      logger.error('Stream error during view', { fileId: file.id, error: err.message });
      if (!res.headersSent) next(err);
      else res.destroy(err);
    });

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

export async function streamFile(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');
    if (file.status !== 'AVAILABLE') {
      throw new AppError(`File is not available for streaming (status: ${file.status})`, 409, 'FILE_NOT_AVAILABLE');
    }

    const fileSize = Number(file.size);
    const storage = StorageFactory.getInstance();
    const rangeHeader = req.headers['range'];

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (!rangeHeader) {
      const stream = await storage.download(file.storagePath);
      res.setHeader('Content-Length', fileSize);
      stream.on('error', (err) => {
        if (!res.headersSent) next(err);
        else res.destroy(err);
      });
      return stream.pipe(res);
    }

    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).json({
        error: { code: 'RANGE_NOT_SATISFIABLE', message: 'Invalid Range header format. Expected: bytes=start-end' },
      });
    }

    const rawStart = match[1];
    const rawEnd = match[2];
    let start;
    let end;

    if (!rawStart && rawEnd) {
      start = Math.max(0, fileSize - parseInt(rawEnd, 10));
      end = fileSize - 1;
    } else if (rawStart && !rawEnd) {
      start = parseInt(rawStart, 10);
      end = fileSize - 1;
    } else {
      start = parseInt(rawStart, 10);
      end = parseInt(rawEnd, 10);
    }

    if (isNaN(start) || isNaN(end) || start > end || start >= fileSize || end >= fileSize) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).json({
        error: { code: 'RANGE_NOT_SATISFIABLE', message: `Range ${start}-${end} is out of bounds for file size ${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const stream = await storage.stream(file.storagePath, { start, end });

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);

    stream.on('error', (err) => {
      logger.error('Stream error during range request', { fileId: file.id, range: `${start}-${end}`, error: err.message });
      if (!res.headersSent) next(err);
      else res.destroy(err);
    });

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /files/:id/signed-url
 * Returns a short-lived URL. Prefer /view and /download for browser clients —
 * signed URLs are cached in Redis and intended for trusted server-to-server use.
 */
export async function getSignedUrl(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');
    if (file.status !== 'AVAILABLE') {
      throw new AppError(`File is not available (status: ${file.status})`, 409, 'FILE_NOT_AVAILABLE');
    }

    const expiresIn = Math.min(Math.max(1, parseInt(req.query.expires || '600', 10)), 86400);
    const storage = StorageFactory.getInstance();

    const url = await getCachedSignedUrl(file.id, expiresIn, () =>
      storage.signedUrl(file.storagePath, expiresIn)
    );
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    if (!url) {
      return res.json({
        url: `/api/v1/files/${file.id}/download`,
        expiresAt: null,
        note: 'Signed URLs are not supported for local storage. Use the /download endpoint instead.',
      });
    }

    logger.info('Signed URL generated', { fileId: file.id, expiresIn });
    res.json({ url, expiresAt, expiresInSeconds: expiresIn });
  } catch (err) {
    next(err);
  }
}
