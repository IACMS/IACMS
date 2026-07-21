import { BaseWorker } from './BaseWorker.js';
import { PrismaFileRepository } from '../infrastructure/persistence/PrismaFileRepository.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * RetryWorker — requeues FAILED files whose retryAt has passed (retryCount < max).
 * Resets status to PENDING so VirusScanWorker picks them up again.
 */
export class RetryWorker extends BaseWorker {
  constructor() {
    super('RetryWorker');
    this.fileRepo = new PrismaFileRepository();
  }

  async processBatch() {
    const files = await this.fileRepo.findDueForRetry({
      take: config.workers.batchSize,
      maxRetries: config.workers.maxRetries,
    });

    if (files.length === 0) return;

    logger.info(`RetryWorker: requeuing ${files.length} FAILED file(s)`);

    for (const file of files) {
      await this.withFileLock(file.id, async () => {
        const updated = await this.fileRepo.transitionStatus(file.id, 'FAILED', 'PENDING', {
          retryAt: null,
          compressed: false,
          compressionType: null,
          thumbnails: null,
          metadata: null,
        });
        if (updated) {
          logger.info('File requeued for retry', {
            fileId: file.id,
            retryCount: file.retryCount,
          });
        }
      });
    }
  }
}
