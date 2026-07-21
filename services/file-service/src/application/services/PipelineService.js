import config from '../../config/index.js';
import { MimeTypeGuard } from '../../domain/value-objects/MimeTypeGuard.js';
import { PrismaFileRepository } from '../../infrastructure/persistence/PrismaFileRepository.js';
import { KafkaPublisher } from '../../infrastructure/queue/KafkaPublisher.js';
import { metrics } from '../../infrastructure/metrics/metrics.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');
const fileRepo = new PrismaFileRepository();

/**
 * Pipeline helpers — shared status transitions and readiness checks.
 */
export class PipelineService {
  /**
   * Whether a PROCESSING file has completed all required processing steps.
   * @param {object} file
   * @returns {boolean}
   */
  static isProcessingComplete(file) {
    const compressDone = !file.compressRequested || file.compressed;
    const needsThumbs = MimeTypeGuard.isImage(file.mimeType) && config.thumbnail.enabled;
    // thumbnails !== null means ThumbnailWorker has run (even if generation produced {})
    const thumbsDone = !needsThumbs || file.thumbnails !== null;
    const metaDone = file.metadata !== null && file.metadata !== undefined;
    return compressDone && thumbsDone && metaDone;
  }

  /**
   * Promote file to AVAILABLE and emit Kafka events if all steps are done.
   * @param {string} fileId
   * @returns {Promise<object|null>} updated file or null if not ready
   */
  static async tryMarkAvailable(fileId) {
    const file = await fileRepo.findByIdRaw(fileId);
    if (!file || file.status !== 'PROCESSING' || file.deleted) return null;
    if (!PipelineService.isProcessingComplete(file)) return null;

    const updated = await fileRepo.update(fileId, { status: 'AVAILABLE' });
    metrics.inc('fms_uploads_total', { status: 'available' });

    await KafkaPublisher.fileUploaded(updated);
    await KafkaPublisher.fileProcessed(updated);
    await KafkaPublisher.audit('FILE_AVAILABLE', updated);

    logger.info('File marked AVAILABLE', { fileId });
    return updated;
  }

  /**
   * Mark file FAILED with retry scheduling.
   * @param {string} fileId
   * @param {string} reason
   */
  static async markFailed(fileId, reason) {
    const file = await fileRepo.findByIdRaw(fileId);
    if (!file) return;

    const retryCount = (file.retryCount || 0) + 1;
    const retryAt =
      retryCount <= config.workers.maxRetries
        ? new Date(Date.now() + retryCount * 15 * 60 * 1000)
        : null;

    await fileRepo.update(fileId, {
      status: 'FAILED',
      retryCount,
      retryAt,
      metadata: {
        ...(typeof file.metadata === 'object' && file.metadata ? file.metadata : {}),
        lastError: reason,
      },
    });

    metrics.inc('fms_worker_errors_total', { reason: 'processing_failed' });
    logger.warn('File marked FAILED', { fileId, reason, retryCount, retryAt });
  }
}
