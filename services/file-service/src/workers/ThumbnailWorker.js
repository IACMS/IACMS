import { BaseWorker } from './BaseWorker.js';
import { PrismaFileRepository } from '../infrastructure/persistence/PrismaFileRepository.js';
import { StorageFactory } from '../infrastructure/storage/StorageFactory.js';
import { ThumbnailGenerator } from '../infrastructure/thumbnail/ThumbnailGenerator.js';
import { MimeTypeGuard } from '../domain/value-objects/MimeTypeGuard.js';
import { PipelineService } from '../application/services/PipelineService.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * ThumbnailWorker — generates image thumbnails for PROCESSING image files.
 */
export class ThumbnailWorker extends BaseWorker {
  constructor() {
    super('ThumbnailWorker');
    this.fileRepo = new PrismaFileRepository();
  }

  async processBatch() {
    if (!config.thumbnail.enabled) return;

    const files = await this.fileRepo.findByStatus('PROCESSING', {
      take: config.workers.batchSize,
    });

    const targets = files.filter(
      (f) =>
        MimeTypeGuard.isImage(f.mimeType) &&
        (!f.thumbnails || Object.keys(f.thumbnails).length === 0)
    );
    if (targets.length === 0) return;

    logger.info(`ThumbnailWorker: processing ${targets.length} file(s)`);

    for (const file of targets) {
      await this.withFileLock(file.id, () => this._processOne(file.id));
    }
  }

  async _processOne(fileId) {
    const file = await this.fileRepo.findByIdRaw(fileId);
    if (
      !file ||
      file.status !== 'PROCESSING' ||
      !MimeTypeGuard.isImage(file.mimeType) ||
      (file.thumbnails && Object.keys(file.thumbnails).length > 0)
    ) {
      return;
    }

    try {
      const storage = StorageFactory.getInstance();
      const stream = await storage.download(file.storagePath);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const thumbnails = await ThumbnailGenerator.generate({ buffer, file, storage });
      await this.fileRepo.update(fileId, {
        thumbnails: thumbnails || {},
      });

      logger.info('Thumbnails generated', { fileId, sizes: Object.keys(thumbnails || {}) });
      await PipelineService.tryMarkAvailable(fileId);
    } catch (err) {
      logger.error('ThumbnailWorker failed', { fileId, error: err.message });
      await PipelineService.markFailed(fileId, err.message);
    }
  }
}
