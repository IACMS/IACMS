import { BaseWorker } from './BaseWorker.js';
import { PrismaFileRepository } from '../infrastructure/persistence/PrismaFileRepository.js';
import { StorageFactory } from '../infrastructure/storage/StorageFactory.js';
import { MetadataExtractor } from '../infrastructure/metadata/MetadataExtractor.js';
import { PipelineService } from '../application/services/PipelineService.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * MetadataWorker — extracts metadata for PROCESSING files, then tries to mark AVAILABLE.
 */
export class MetadataWorker extends BaseWorker {
  constructor() {
    super('MetadataWorker');
    this.fileRepo = new PrismaFileRepository();
  }

  async processBatch() {
    const files = await this.fileRepo.findByStatus('PROCESSING', {
      take: config.workers.batchSize,
    });

    const targets = files.filter((f) => f.metadata === null || f.metadata === undefined);
    if (targets.length === 0) return;

    logger.info(`MetadataWorker: processing ${targets.length} file(s)`);

    for (const file of targets) {
      await this.withFileLock(file.id, () => this._processOne(file.id));
    }
  }

  async _processOne(fileId) {
    const file = await this.fileRepo.findByIdRaw(fileId);
    if (!file || file.status !== 'PROCESSING' || file.metadata !== null) return;

    try {
      const storage = StorageFactory.getInstance();
      const stream = await storage.download(file.storagePath);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const metadata = await MetadataExtractor.extract(buffer, file.mimeType);
      await this.fileRepo.update(fileId, { metadata });

      // Ensure non-image / non-compress paths can complete:
      // if thumbs not needed and compress not needed, tryMarkAvailable will succeed.
      // If compress/thumbs still pending, they will call tryMarkAvailable later.
      // For images where thumbnail worker hasn't run, leave PROCESSING.
      // For files that don't need compress, mark compress path complete implicitly:
      if (!file.compressRequested && !file.compressed) {
        // leave compressed=false; PipelineService treats !compressRequested as done
      }

      logger.info('Metadata extracted', { fileId });
      await PipelineService.tryMarkAvailable(fileId);
    } catch (err) {
      logger.error('MetadataWorker failed', { fileId, error: err.message });
      await PipelineService.markFailed(fileId, err.message);
    }
  }
}
