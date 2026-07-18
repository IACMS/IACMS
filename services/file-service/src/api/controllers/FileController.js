import Busboy from 'busboy';
import { Transform } from 'stream';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { StorageFactory } from '../../infrastructure/storage/StorageFactory.js';
import { PrismaFileRepository } from '../../infrastructure/persistence/PrismaFileRepository.js';
import { StoragePath } from '../../domain/value-objects/StoragePath.js';
import { MimeTypeGuard } from '../../domain/value-objects/MimeTypeGuard.js';
import { validateUploadFields } from '../validators/upload.validator.js';
import { validateListQuery } from '../validators/query.validator.js';
import { NotFoundError, ValidationError, AppError } from '../../../../shared/common/errors.js';
import config from '../../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');
const fileRepo = new PrismaFileRepository();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Serialize a file DB record for API responses.
 * - Converts BigInt size to Number (safe: 100GB < Number.MAX_SAFE_INTEGER)
 * - Omits storagePath (internal, never exposed to clients)
 */
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
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    url: `/api/v1/files/${file.id}/view`,
    downloadUrl: `/api/v1/files/${file.id}/download`,
  };
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /files
 * Single file upload via multipart/form-data.
 *
 * Required multipart fields (must appear BEFORE the file field):
 *   service    (string) e.g. "case-management"
 *   module     (string) e.g. "evidence"
 *
 * Optional fields:
 *   referenceId  (string) e.g. "CASE-123"
 *   compress     (boolean string) "true" | "false"
 *   visibility   "private" | "internal" | "public"
 *
 * Phase 1 note: files are written directly to permanent storage and set to
 * AVAILABLE immediately. Phase 4 workers will introduce the full pipeline
 * (PENDING → SCANNING → PROCESSING → AVAILABLE).
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
        files: 1,     // single file per request (batch is a separate endpoint)
        fields: 20,
      },
    });

    const fields = {};
    let fileUploadPromise = null;

    // Collect metadata fields (must arrive before the file field in multipart body)
    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (fieldname, fileStream, info) => {
      const { filename = 'unnamed', mimeType: rawMime = 'application/octet-stream' } = info;

      // Validate required fields (collected above, since fields appear first in the form)
      let validatedFields;
      try {
        validatedFields = validateUploadFields(fields);
      } catch (err) {
        fileStream.resume(); // drain the stream to avoid connection hang
        return finish(err);
      }

      // Block dangerous file types by extension
      if (MimeTypeGuard.isBlocked(filename)) {
        fileStream.resume();
        return finish(new ValidationError(`File type is not allowed: "${filename}"`));
      }

      const mimeType = MimeTypeGuard.normalize(rawMime);
      const fileId = uuidv4();
      const storagePath = StoragePath.build({
        service: validatedFields.service,
        module: validatedFields.module,
        fileId,
      });

      // Hashing transform: compute SHA-256 and track byte count while the stream flows
      const hash = createHash('sha256');
      let byteCount = 0;
      let sizeLimitHit = false;

      const measuring = new Transform({
        transform(chunk, _encoding, cb) {
          hash.update(chunk);
          byteCount += chunk.length;
          this.push(chunk);
          cb();
        },
      });

      // busboy fires 'limit' when fileSize limit is reached
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

      // Chain: upload stream → hash computation → MinIO/local storage → create DB record
      fileUploadPromise = storage
        .upload(storagePath, measuring, mimeType)
        .then(async () => {
          if (sizeLimitHit) {
            throw new ValidationError('File too large');
          }

          const checksum = `sha256:${hash.digest('hex')}`;

          // Look up per-service retention policy
          const policy = await fileRepo.getRetentionPolicy(validatedFields.service);
          const retentionDays =
            policy !== null
              ? policy.retentionDays   // could be null (keep forever) or a number
              : config.retention.defaultSoftDeleteDays;

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
            storageProvider: config.storage.provider,
            compressed: false,
            status: 'AVAILABLE',  // Phase 1: direct to AVAILABLE. Phase 4 changes this to PENDING.
            retentionDays,
          });

          logger.info('File uploaded successfully', {
            fileId: file.id,
            service: file.service,
            module: file.module,
            size: byteCount,
            mimeType,
            storageProvider: config.storage.provider,
          });

          return file;
        });
    });

    bb.on('error', (err) => finish(err));

    bb.on('finish', async () => {
      if (!fileUploadPromise) {
        return finish(new ValidationError('No file field found in the request. Use multipart/form-data with a "file" field.'));
      }
      try {
        const file = await fileUploadPromise;
        res.status(201).json(serializeFile(file));
        finish();
      } catch (err) {
        finish(err);
      }
    });

    req.pipe(bb);
  }).catch(next);
}

/**
 * POST /files/batch
 * Upload multiple files in a single multipart request (up to 100 files).
 *
 * Same metadata fields as single upload (service, module, referenceId, compress, visibility)
 * applied to ALL files in the batch. Each file gets its own UUID, checksum, and DB record.
 *
 * Client must send metadata fields BEFORE file fields in the multipart body.
 *
 * Response 201:
 *   { uploaded: [FileResponseDto], failed: [{ originalName, reason }] }
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

      // Block dangerous extensions per-file — don't abort the whole batch
      if (MimeTypeGuard.isBlocked(filename)) {
        fileStream.resume();
        results.failed.push({ originalName: filename, reason: 'File type not allowed' });
        return;
      }

      // Validate shared metadata fields (must arrive before file fields)
      let validatedFields;
      try {
        validatedFields = validateUploadFields(fields);
      } catch (err) {
        fileStream.resume();
        results.failed.push({ originalName: filename, reason: err.message });
        return;
      }

      const mimeType    = MimeTypeGuard.normalize(rawMime);
      const fileId      = uuidv4();
      const storagePath = StoragePath.build({
        service: validatedFields.service,
        module:  validatedFields.module,
        fileId,
      });

      const hash = createHash('sha256');
      let byteCount = 0;

      const measuring = new Transform({
        transform(chunk, _, cb) {
          hash.update(chunk);
          byteCount += chunk.length;
          this.push(chunk);
          cb();
        },
      });

      fileStream.on('error', (err) => measuring.destroy(err));
      fileStream.pipe(measuring);

      const storage = StorageFactory.getInstance();

      const promise = storage
        .upload(storagePath, measuring, mimeType)
        .then(async () => {
          const checksum = `sha256:${hash.digest('hex')}`;
          const policy   = await fileRepo.getRetentionPolicy(validatedFields.service);
          const retentionDays = policy !== null
            ? policy.retentionDays
            : config.retention.defaultSoftDeleteDays;

          const file = await fileRepo.create({
            id: fileId,
            service:         validatedFields.service,
            module:          validatedFields.module,
            ownerId:         req.user.id,
            referenceId:     validatedFields.referenceId || null,
            originalName:    filename,
            storedName:      `${fileId}.bin`,
            mimeType,
            size:            BigInt(byteCount),
            checksum,
            storagePath,
            storageProvider: config.storage.provider,
            compressed:      false,
            status:          'AVAILABLE',
            retentionDays,
          });

          results.uploaded.push(serializeFile(file));
          logger.info('Batch file uploaded', { fileId: file.id, originalName: filename });
        })
        .catch((err) => {
          results.failed.push({ originalName: filename, reason: err.message });
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

/**
 * GET /files/:id
 * Returns file metadata. Does NOT return the file bytes or storagePath.
 */
export async function getFile(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');
    res.json(serializeFile(file));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /files
 * List files with optional filters. Results are scoped by query params.
 */
export async function listFiles(req, res, next) {
  try {
    const query = validateListQuery(req.query);
    const result = await fileRepo.list(query);

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

/**
 * DELETE /files/:id
 * Soft delete. Sets deleted=true and computes scheduledDeleteAt from retention policy.
 * Physical deletion is handled by CleanupWorker (Phase 4) after the retention period.
 */
export async function deleteFile(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');

    // Compute scheduledDeleteAt from the file's retention policy
    let scheduledDeleteAt = null;
    if (file.retentionDays !== null && file.retentionDays !== undefined) {
      scheduledDeleteAt = new Date(
        Date.now() + file.retentionDays * 24 * 60 * 60 * 1000
      );
    }
    // If retentionDays is null → keep forever → scheduledDeleteAt stays null

    await fileRepo.softDelete(file.id, { scheduledDeleteAt });

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

/**
 * GET /files/:id/download
 * Returns file bytes as an attachment (browser shows save dialog).
 * Content-Disposition: attachment
 */
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

/**
 * GET /files/:id/view
 * Returns file bytes for inline browser viewing.
 * Content-Disposition: inline — browser renders PDFs, images, etc. in-tab.
 */
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

/**
 * GET /files/:id/stream
 * HTTP Range-based streaming — returns 206 Partial Content.
 * Essential for video/audio seek in browsers and media players.
 * Falls back to full file (200) when no Range header is present.
 *
 * Range header format: "bytes=start-end" | "bytes=start-" | "bytes=-suffix"
 */
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
      // No Range header — serve full file with 200
      const stream = await storage.download(file.storagePath);
      res.setHeader('Content-Length', fileSize);
      stream.on('error', (err) => {
        if (!res.headersSent) next(err);
        else res.destroy(err);
      });
      return stream.pipe(res);
    }

    // Parse Range: "bytes=start-end"
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).json({
        error: { code: 'RANGE_NOT_SATISFIABLE', message: 'Invalid Range header format. Expected: bytes=start-end' },
      });
    }

    const rawStart = match[1];
    const rawEnd   = match[2];
    let start, end;

    if (!rawStart && rawEnd) {
      // Suffix range: bytes=-500 (last 500 bytes)
      start = Math.max(0, fileSize - parseInt(rawEnd, 10));
      end   = fileSize - 1;
    } else if (rawStart && !rawEnd) {
      // Open-ended range: bytes=9500-
      start = parseInt(rawStart, 10);
      end   = fileSize - 1;
    } else {
      // Normal range: bytes=0-1023
      start = parseInt(rawStart, 10);
      end   = parseInt(rawEnd, 10);
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
 * GET /files/:id/signed-url?expires=600
 * Returns a time-limited presigned URL for the file.
 *
 * NOTE: The URL points to MinIO directly (internal). This endpoint is intended
 * for server-to-server use. Browser clients should use /view or /download.
 * For local storage, returns the /download endpoint URL as a fallback.
 */
export async function getSignedUrl(req, res, next) {
  try {
    const file = await fileRepo.findById(req.params.id);
    if (!file) throw new NotFoundError('File');
    if (file.status !== 'AVAILABLE') {
      throw new AppError(`File is not available (status: ${file.status})`, 409, 'FILE_NOT_AVAILABLE');
    }

    // Clamp expires: minimum 1s, maximum 24h
    const expiresIn = Math.min(Math.max(1, parseInt(req.query.expires || '600', 10)), 86400);

    const storage = StorageFactory.getInstance();
    const url = await storage.signedUrl(file.storagePath, expiresIn);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    if (!url) {
      // Local storage fallback
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
