import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { Transform, Readable } from 'stream';
import { PrismaChunkRepository } from '../../infrastructure/persistence/PrismaChunkRepository.js';
import { PrismaFileRepository } from '../../infrastructure/persistence/PrismaFileRepository.js';
import { RedisUploadState } from '../../infrastructure/cache/RedisUploadState.js';
import { StorageFactory } from '../../infrastructure/storage/StorageFactory.js';
import { StoragePath } from '../../domain/value-objects/StoragePath.js';
import { NotFoundError, ValidationError, AppError } from '../../../../shared/common/errors.js';
import config from '../../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * ChunkService — orchestrates the entire chunked upload lifecycle.
 *
 * Flow:
 *   1. initUpload()    → creates session, returns uploadId
 *   2. uploadChunk()   → stores individual chunk in temp storage, tracks in Redis
 *   3. completeUpload() → merges all chunks into permanent storage, creates File record
 *   4. getStatus()     → returns progress + missing chunks (for resume)
 *
 * Resume support:
 *   If a client disconnects after chunk 13 of 50, calling getStatus() returns
 *   missing: [14, 15, ..., 50]. The client resumes from chunk 14.
 *   uploadChunk() is idempotent: re-sending an already-received chunk is a no-op.
 */
export class ChunkService {
  constructor() {
    this.chunkRepo = new PrismaChunkRepository();
    this.fileRepo  = new PrismaFileRepository();
    this.redis     = new RedisUploadState();
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  /**
   * Initialize a new chunked upload session.
   *
   * @param {object} opts
   * @param {string} opts.service
   * @param {string} opts.module
   * @param {string} opts.ownerId
   * @param {string} [opts.referenceId]
   * @param {string} opts.originalName
   * @param {string} opts.mimeType
   * @param {number} opts.totalSize       - total file size in bytes
   * @param {number} opts.totalChunks     - how many chunks the client will send
   * @param {number} opts.chunkSize       - expected size of each chunk in bytes
   * @returns {Promise<object>}           - the ChunkUpload DB record
   */
  async initUpload({ service, module, ownerId, referenceId, originalName, mimeType, totalSize, totalChunks, chunkSize }) {
    const uploadId  = uuidv4();
    const tempPath  = `tmp/uploads/${uploadId}`;
    const expiresAt = new Date(Date.now() + config.chunk.ttlHours * 60 * 60 * 1000);

    const upload = await this.chunkRepo.createUpload({
      id: uploadId,
      service,
      module,
      ownerId,
      referenceId: referenceId || null,
      originalName,
      mimeType,
      totalSize: BigInt(totalSize),
      totalChunks,
      receivedChunks: 0,
      chunkSize,
      status: 'IN_PROGRESS',
      tempPath,
      expiresAt,
    });

    // Pre-set Redis TTL so the chunk tracking key auto-expires if never completed
    await this.redis.setExpiry(uploadId, config.chunk.ttlHours * 60 * 60).catch(() => {});

    logger.info('Chunk upload initialized', { uploadId, totalChunks, totalSize, service, module, originalName });

    return upload;
  }

  // ── Upload Chunk ───────────────────────────────────────────────────────────

  /**
   * Receive and store a single chunk.
   *
   * @param {object} opts
   * @param {string} opts.uploadId
   * @param {number} opts.chunkNumber     - 1-based
   * @param {import('stream').Readable} opts.stream  - raw request body
   * @param {string|null} [opts.chunkChecksum]       - optional SHA-256 from X-Chunk-Checksum header
   * @returns {Promise<{ receivedChunks: number, totalChunks: number }>}
   */
  async uploadChunk({ uploadId, chunkNumber, stream, chunkChecksum }) {
    const upload = await this._assertUploadActive(uploadId);

    if (chunkNumber < 1 || chunkNumber > upload.totalChunks) {
      throw new ValidationError(
        `chunkNumber ${chunkNumber} is out of range. Must be between 1 and ${upload.totalChunks}.`
      );
    }

    // Idempotency: if this chunk was already received, skip re-upload
    const alreadyReceived = await this.redis.hasChunk(uploadId, chunkNumber);
    if (alreadyReceived) {
      logger.info('Duplicate chunk received — skipping', { uploadId, chunkNumber });
      const count = await this.redis.getReceivedCount(uploadId);
      return { receivedChunks: count, totalChunks: upload.totalChunks };
    }

    const chunkPath = StoragePath.buildChunkTemp({ uploadId, chunkNumber });
    const storage   = StorageFactory.getInstance();

    // Track byte count while streaming
    let chunkByteCount = 0;
    const measuring = new Transform({
      transform(chunk, _, cb) {
        chunkByteCount += chunk.length;
        this.push(chunk);
        cb();
      },
    });

    stream.on('error', (err) => measuring.destroy(err));
    stream.pipe(measuring);

    await storage.upload(chunkPath, measuring, 'application/octet-stream');

    // Mark received in Redis first (fast), then persist to DB
    await this.redis.addChunk(uploadId, chunkNumber);

    await this.chunkRepo.createChunk({
      uploadId,
      chunkNumber,
      size: chunkByteCount,
      checksum: chunkChecksum || '',
      storedPath: chunkPath,
    });

    await this.chunkRepo.incrementReceivedChunks(uploadId);

    const receivedCount = await this.redis.getReceivedCount(uploadId);

    logger.info('Chunk uploaded', {
      uploadId, chunkNumber, chunkByteCount,
      received: receivedCount, total: upload.totalChunks,
    });

    return { receivedChunks: receivedCount, totalChunks: upload.totalChunks };
  }

  // ── Complete ───────────────────────────────────────────────────────────────

  /**
   * Merge all chunks into permanent storage and create the File record.
   *
   * Uses async generator streaming to merge chunks one-by-one without buffering
   * the entire file in memory — works for files of any size.
   *
   * @param {string} uploadId
   * @returns {Promise<{ fileId: string, status: string, checksum: string, size: number }>}
   */
  async completeUpload(uploadId) {
    const upload = await this._assertUploadActive(uploadId);

    // Verify all chunks have been received
    const receivedCount = await this.redis.getReceivedCount(uploadId);
    if (receivedCount < upload.totalChunks) {
      const missing = await this.redis.getMissingChunks(uploadId, upload.totalChunks);
      const preview = missing.slice(0, 20);
      throw new ValidationError(
        `Cannot complete: ${receivedCount}/${upload.totalChunks} chunks received. ` +
        `Missing: [${preview.join(', ')}${missing.length > 20 ? ` ... and ${missing.length - 20} more` : ''}]`
      );
    }

    // Transition to MERGING to prevent concurrent complete calls
    await this.chunkRepo.updateUploadStatus(uploadId, 'MERGING');

    try {
      const storage    = StorageFactory.getInstance();
      const fileId     = uuidv4();
      const permanentPath = StoragePath.build({
        service: upload.service,
        module:  upload.module,
        fileId,
      });

      // Stream-merge: fetch each chunk from storage in order,
      // hash and size-count as we go, write to permanent path
      const hash = createHash('sha256');
      let mergedSize = 0;

      // Async generator that yields all chunks sequentially from storage
      const chunkRepo = this.chunkRepo;
      async function* streamAllChunks() {
        for (let i = 1; i <= upload.totalChunks; i++) {
          const chunkPath   = StoragePath.buildChunkTemp({ uploadId, chunkNumber: i });
          const chunkStream = await storage.download(chunkPath);
          for await (const data of chunkStream) {
            hash.update(data);
            mergedSize += data.length;
            yield data;
          }
        }
      }

      const mergedStream = Readable.from(streamAllChunks());
      await storage.upload(permanentPath, mergedStream, upload.mimeType);

      const checksum = `sha256:${hash.digest('hex')}`;

      // Look up per-service retention policy
      const policy       = await this.fileRepo.getRetentionPolicy(upload.service);
      const retentionDays = policy !== null
        ? policy.retentionDays
        : config.retention.defaultSoftDeleteDays;

      // Create the final File record
      const file = await this.fileRepo.create({
        id: fileId,
        service:         upload.service,
        module:          upload.module,
        ownerId:         upload.ownerId,
        referenceId:     upload.referenceId,
        originalName:    upload.originalName,
        storedName:      `${fileId}.bin`,
        mimeType:        upload.mimeType,
        size:            BigInt(mergedSize),
        checksum,
        storagePath:     permanentPath,
        storageProvider: config.storage.provider,
        compressed:      false,
        status:          'AVAILABLE',
        retentionDays,
      });

      // Mark upload complete
      await this.chunkRepo.updateUploadStatus(uploadId, 'COMPLETE');

      // Clean up temp chunks asynchronously (don't block the response)
      this._deleteTempChunks(storage, uploadId, upload.totalChunks).catch((err) =>
        logger.warn('Failed to delete temp chunks', { uploadId, error: err.message })
      );

      // Clean up Redis tracking state
      this.redis.deleteUploadState(uploadId).catch(() => {});

      logger.info('Chunk upload merged and complete', {
        uploadId, fileId, mergedSize, checksum,
        chunks: upload.totalChunks,
      });

      return {
        fileId:   file.id,
        status:   file.status,
        checksum,
        size:     mergedSize,
      };
    } catch (err) {
      // Roll back to IN_PROGRESS so the client can retry
      await this.chunkRepo.updateUploadStatus(uploadId, 'IN_PROGRESS').catch(() => {});
      throw err;
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  /**
   * Return current upload progress including which chunks are still missing.
   * Used by clients to determine where to resume after a disconnect.
   *
   * @param {string} uploadId
   * @returns {Promise<object>}
   */
  async getStatus(uploadId) {
    const upload = await this.chunkRepo.findUploadById(uploadId);
    if (!upload) throw new NotFoundError('Upload session');

    const received = await this.redis.getReceivedChunks(uploadId);
    const missing  = [];
    for (let i = 1; i <= upload.totalChunks; i++) {
      if (!received.has(i)) missing.push(i);
    }

    return {
      uploadId:       upload.id,
      status:         upload.status,
      service:        upload.service,
      module:         upload.module,
      originalName:   upload.originalName,
      mimeType:       upload.mimeType,
      totalSize:      Number(upload.totalSize),
      totalChunks:    upload.totalChunks,
      receivedChunks: received.size,
      missingChunks:  missing,
      expiresAt:      upload.expiresAt,
      isExpired:      upload.expiresAt < new Date(),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Assert that the upload exists and is in IN_PROGRESS status.
   * Throws appropriate errors for not-found, expired, or wrong-status.
   */
  async _assertUploadActive(uploadId) {
    const upload = await this.chunkRepo.findUploadById(uploadId);
    if (!upload) throw new NotFoundError('Upload session');

    if (upload.status === 'EXPIRED') {
      throw new AppError('Upload session has expired. Start a new upload with POST /uploads/init.', 410, 'UPLOAD_EXPIRED');
    }
    if (upload.status === 'COMPLETE') {
      throw new AppError('Upload is already complete.', 409, 'UPLOAD_ALREADY_COMPLETE');
    }
    if (upload.status === 'MERGING') {
      throw new AppError('Upload is currently being merged. Please wait.', 409, 'UPLOAD_MERGING');
    }
    if (upload.status !== 'IN_PROGRESS') {
      throw new AppError(`Upload is in an unexpected status: ${upload.status}`, 409, 'INVALID_UPLOAD_STATUS');
    }
    if (upload.expiresAt < new Date()) {
      // Expired but not yet marked — mark it now
      await this.chunkRepo.updateUploadStatus(uploadId, 'EXPIRED').catch(() => {});
      throw new AppError('Upload session has expired. Start a new upload with POST /uploads/init.', 410, 'UPLOAD_EXPIRED');
    }

    return upload;
  }

  /**
   * Delete all temp chunk files from storage (called after successful merge).
   * Errors are suppressed — chunk cleanup failure should not affect the response.
   */
  async _deleteTempChunks(storage, uploadId, totalChunks) {
    for (let i = 1; i <= totalChunks; i++) {
      const chunkPath = StoragePath.buildChunkTemp({ uploadId, chunkNumber: i });
      await storage.delete(chunkPath).catch(() => {});
    }
    await this.chunkRepo.deleteChunks(uploadId).catch(() => {});
    logger.info('Temp chunks deleted', { uploadId, totalChunks });
  }
}
