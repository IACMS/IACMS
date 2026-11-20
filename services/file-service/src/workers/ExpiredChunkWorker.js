import { PrismaChunkRepository } from '../infrastructure/persistence/PrismaChunkRepository.js';
import { RedisUploadState } from '../infrastructure/cache/RedisUploadState.js';
import { StorageFactory } from '../infrastructure/storage/StorageFactory.js';
import { StoragePath } from '../domain/value-objects/StoragePath.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * ExpiredChunkWorker — runs on a schedule and cleans up abandoned chunked upload sessions.
 *
 * An upload session is considered expired when:
 *   status = IN_PROGRESS AND expiresAt < NOW()
 *
 * For each expired session, this worker:
 *   1. Deletes temp chunk files from storage (MinIO or local)
 *   2. Deletes the Redis chunk tracking state
 *   3. Marks the ChunkUpload record as EXPIRED in the DB
 *
 * Default interval: 1 hour
 * Processes up to 50 expired sessions per run (batched to avoid long locks).
 *
 * In embedded mode (dev): runs in the same process as the HTTP server.
 * In standalone mode (prod): runs in the separate file-service-workers container.
 */
export class ExpiredChunkWorker {
  constructor() {
    this.chunkRepo  = new PrismaChunkRepository();
    this.redis      = new RedisUploadState();
    this._timer     = null;
    this._running   = false;
  }

  /**
   * Start the worker on the given interval.
   * Also runs once immediately at startup to catch any sessions that expired
   * while the service was down.
   *
   * @param {number} intervalMs  default: 3_600_000 (1 hour)
   */
  start(intervalMs = 60 * 60 * 1000) {
    logger.info('ExpiredChunkWorker starting', { intervalMs });

    // Run once immediately at startup
    this._run().catch((err) =>
      logger.error('ExpiredChunkWorker initial run failed', { error: err.message })
    );

    this._timer = setInterval(() => {
      this._run().catch((err) =>
        logger.error('ExpiredChunkWorker scheduled run failed', { error: err.message })
      );
    }, intervalMs);
  }

  /**
   * Stop the worker (called during graceful shutdown).
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      logger.info('ExpiredChunkWorker stopped');
    }
  }

  /**
   * One cleanup cycle. Finds expired sessions and deletes their temp data.
   * Protected against overlapping runs via the _running flag.
   */
  async _run() {
    if (this._running) {
      logger.info('ExpiredChunkWorker: previous run still in progress, skipping');
      return;
    }

    this._running = true;

    try {
      const expired = await this.chunkRepo.findExpiredUploads(50);

      if (expired.length === 0) {
        logger.info('ExpiredChunkWorker: no expired sessions found');
        return;
      }

      logger.info(`ExpiredChunkWorker: cleaning up ${expired.length} expired session(s)`);

      const storage = StorageFactory.getInstance();

      for (const upload of expired) {
        await this._cleanupOne(storage, upload);
      }

      logger.info(`ExpiredChunkWorker: completed cleanup of ${expired.length} session(s)`);
    } catch (err) {
      logger.error('ExpiredChunkWorker: run failed', { error: err.message });
    } finally {
      this._running = false;
    }
  }

  /**
   * Clean up a single expired upload session.
   * Errors on individual steps are logged but don't abort the cleanup of other sessions.
   */
  async _cleanupOne(storage, upload) {
    logger.info('Cleaning up expired upload', {
      uploadId: upload.id,
      originalName: upload.originalName,
      expiredAt: upload.expiresAt,
      chunksReceived: upload.receivedChunks,
      chunksTotal: upload.totalChunks,
    });

    // 1. Delete temp chunk files from storage
    for (let i = 1; i <= upload.totalChunks; i++) {
      const chunkPath = StoragePath.buildChunkTemp({ uploadId: upload.id, chunkNumber: i });
      await storage.delete(chunkPath).catch((err) => {
        // Missing chunk files are expected — only log unexpected errors
        if (!err.message?.includes('Not Found') && !err.message?.includes('NoSuchKey')) {
          logger.warn('Failed to delete temp chunk', { uploadId: upload.id, chunkNumber: i, error: err.message });
        }
      });
    }

    // 2. Delete Redis tracking state
    await this.redis.deleteUploadState(upload.id).catch((err) => {
      logger.warn('Failed to delete Redis state for expired upload', { uploadId: upload.id, error: err.message });
    });

    // 3. Delete chunk DB records (cascaded via ChunkUpload relation but explicit here)
    await this.chunkRepo.deleteChunks(upload.id).catch(() => {});

    // 4. Mark ChunkUpload as EXPIRED in DB
    await this.chunkRepo.markExpired(upload.id).catch((err) => {
      logger.error('Failed to mark upload as expired in DB', { uploadId: upload.id, error: err.message });
    });

    logger.info('Expired upload cleaned up', { uploadId: upload.id });
  }
}
