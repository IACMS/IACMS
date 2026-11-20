import { Readable } from 'stream';
import { createHash } from 'crypto';
import { BaseWorker } from './BaseWorker.js';
import { PrismaFileRepository } from '../infrastructure/persistence/PrismaFileRepository.js';
import { StorageFactory } from '../infrastructure/storage/StorageFactory.js';
import { ImageCompressor } from '../infrastructure/compression/ImageCompressor.js';
import { VideoCompressor } from '../infrastructure/compression/VideoCompressor.js';
import { ZipCompressor } from '../infrastructure/compression/ZipCompressor.js';
import { MimeTypeGuard } from '../domain/value-objects/MimeTypeGuard.js';
import { PipelineService } from '../application/services/PipelineService.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * CompressionWorker — compresses PROCESSING files when compressRequested=true.
 */
export class CompressionWorker extends BaseWorker {
  constructor() {
    super('CompressionWorker');
    this.fileRepo = new PrismaFileRepository();
  }

  async processBatch() {
    const files = await this.fileRepo.findByStatus('PROCESSING', {
      take: config.workers.batchSize,
    });

    const targets = files.filter((f) => f.compressRequested && !f.compressed);
    if (targets.length === 0) return;

    logger.info(`CompressionWorker: processing ${targets.length} file(s)`);

    for (const file of targets) {
      await this.withFileLock(file.id, () => this._processOne(file.id));
    }
  }

  async _processOne(fileId) {
    const file = await this.fileRepo.findByIdRaw(fileId);
    if (!file || file.status !== 'PROCESSING' || !file.compressRequested || file.compressed) {
      return;
    }

    try {
      const storage = StorageFactory.getInstance();
      const stream = await storage.download(file.storagePath);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const input = Buffer.concat(chunks);

      let result = null;
      if (MimeTypeGuard.isImage(file.mimeType)) {
        result = await ImageCompressor.compress(input);
      } else if (MimeTypeGuard.isVideo(file.mimeType)) {
        result = await VideoCompressor.compress(input);
      } else {
        result = await ZipCompressor.compress(input);
      }

      if (!result) {
        // Compression skipped/disabled — mark as "done" without changing bytes
        await this.fileRepo.update(fileId, {
          compressed: true,
          compressionType: null,
        });
      } else {
        const hash = createHash('sha256').update(result.buffer).digest('hex');
        await storage.upload(
          file.storagePath,
          Readable.from(result.buffer),
          result.mimeType,
          result.buffer.length
        );
        await this.fileRepo.update(fileId, {
          compressed: true,
          compressionType: result.compressionType,
          mimeType: result.mimeType,
          size: BigInt(result.buffer.length),
          checksum: `sha256:${hash}`,
        });
      }

      logger.info('Compression complete', { fileId });
      await PipelineService.tryMarkAvailable(fileId);
    } catch (err) {
      logger.error('CompressionWorker failed', { fileId, error: err.message });
      await PipelineService.markFailed(fileId, err.message);
    }
  }
}
