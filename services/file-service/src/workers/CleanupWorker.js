import { BaseWorker } from './BaseWorker.js';
import { PrismaFileRepository } from '../infrastructure/persistence/PrismaFileRepository.js';
import { StorageFactory } from '../infrastructure/storage/StorageFactory.js';
import { KafkaPublisher } from '../infrastructure/queue/KafkaPublisher.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * CleanupWorker — permanently deletes soft-deleted files past scheduledDeleteAt.
 * Respects retention: files with scheduledDeleteAt=null are never deleted.
 */
export class CleanupWorker extends BaseWorker {
  constructor() {
    super('CleanupWorker');
    this.fileRepo = new PrismaFileRepository();
  }

  async processBatch() {
    const files = await this.fileRepo.findDueForPermanentDelete({
      take: config.workers.batchSize * 5,
    });

    if (files.length === 0) {
      logger.info('CleanupWorker: no files due for permanent deletion');
      return;
    }

    logger.info(`CleanupWorker: permanently deleting ${files.length} file(s)`);
    const storage = StorageFactory.getInstance();

    for (const file of files) {
      await this.withFileLock(file.id, async () => {
        try {
          await storage.delete(file.storagePath).catch((err) => {
            logger.warn('Failed to delete storage object', {
              fileId: file.id,
              error: err.message,
            });
          });

          if (file.thumbnails && typeof file.thumbnails === 'object') {
            for (const thumbPath of Object.values(file.thumbnails)) {
              if (typeof thumbPath === 'string') {
                await storage.delete(thumbPath).catch(() => {});
              }
            }
          }

          await this.fileRepo.hardDelete(file.id);
          await KafkaPublisher.filePermanentlyDeleted(file);
          await KafkaPublisher.audit('FILE_PERMANENTLY_DELETED', file);

          logger.info('File permanently deleted', { fileId: file.id });
        } catch (err) {
          logger.error('CleanupWorker failed for file', { fileId: file.id, error: err.message });
        }
      });
    }
  }
}
