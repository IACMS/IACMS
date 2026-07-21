import { BaseWorker } from './BaseWorker.js';
import { PrismaFileRepository } from '../infrastructure/persistence/PrismaFileRepository.js';
import { StorageFactory } from '../infrastructure/storage/StorageFactory.js';
import { ClamAVScanner } from '../infrastructure/virusScan/ClamAVScanner.js';
import { KafkaPublisher } from '../infrastructure/queue/KafkaPublisher.js';
import { PipelineService } from '../application/services/PipelineService.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * VirusScanWorker — picks PENDING files, scans with ClamAV (if enabled),
 * then transitions to PROCESSING or FAILED.
 */
export class VirusScanWorker extends BaseWorker {
  constructor() {
    super('VirusScanWorker');
    this.fileRepo = new PrismaFileRepository();
    this.scanner = new ClamAVScanner();
  }

  async processBatch() {
    const files = await this.fileRepo.findByStatus('PENDING', {
      take: config.workers.batchSize,
    });

    if (files.length === 0) return;

    logger.info(`VirusScanWorker: processing ${files.length} PENDING file(s)`);

    for (const file of files) {
      await this.withFileLock(file.id, () => this._processOne(file.id));
    }
  }

  async _processOne(fileId) {
    const claimed = await this.fileRepo.transitionStatus(fileId, 'PENDING', 'SCANNING');
    if (!claimed) return;

    try {
      if (!config.virusScan.enabled) {
        await this.fileRepo.transitionStatus(fileId, 'SCANNING', 'PROCESSING');
        logger.info('Virus scan skipped (disabled) → PROCESSING', { fileId });
        return;
      }

      const storage = StorageFactory.getInstance();
      const stream = await storage.download(claimed.storagePath);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const result = await this.scanner.scan(buffer);

      if (!result.clean) {
        await this.fileRepo.update(fileId, { status: 'FAILED' });
        await storage.delete(claimed.storagePath).catch(() => {});
        await KafkaPublisher.fileVirusFound(claimed, result.threat);
        await KafkaPublisher.audit('FILE_VIRUS_FOUND', claimed);
        logger.warn('Virus found — file rejected', { fileId, threat: result.threat });
        return;
      }

      await this.fileRepo.transitionStatus(fileId, 'SCANNING', 'PROCESSING');
      logger.info('Virus scan clean → PROCESSING', { fileId });
    } catch (err) {
      logger.error('VirusScanWorker failed', { fileId, error: err.message });
      await PipelineService.markFailed(fileId, err.message);
    }
  }
}
