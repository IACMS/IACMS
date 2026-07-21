import { ExpiredChunkWorker } from './ExpiredChunkWorker.js';
import { VirusScanWorker } from './VirusScanWorker.js';
import { CompressionWorker } from './CompressionWorker.js';
import { ThumbnailWorker } from './ThumbnailWorker.js';
import { MetadataWorker } from './MetadataWorker.js';
import { CleanupWorker } from './CleanupWorker.js';
import { RetryWorker } from './RetryWorker.js';
import { PrismaFileRepository } from '../infrastructure/persistence/PrismaFileRepository.js';
import { metrics } from '../infrastructure/metrics/metrics.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * Start all FMS background workers and return a stop() handle.
 */
export function startWorkers() {
  const workers = [
    new VirusScanWorker(),
    new CompressionWorker(),
    new ThumbnailWorker(),
    new MetadataWorker(),
    new CleanupWorker(),
    new RetryWorker(),
    new ExpiredChunkWorker(),
  ];

  workers[0].start(config.workers.virusScanIntervalMs);
  workers[1].start(config.workers.processingIntervalMs);
  workers[2].start(config.workers.processingIntervalMs);
  workers[3].start(config.workers.processingIntervalMs);
  workers[4].start(config.workers.cleanupIntervalMs);
  workers[5].start(config.workers.retryIntervalMs);
  workers[6].start(config.workers.expiredChunkIntervalMs);

  // Periodically publish queue depth gauge
  const fileRepo = new PrismaFileRepository();
  const metricsTimer = setInterval(() => {
    fileRepo
      .countByStatuses(['PENDING', 'SCANNING', 'PROCESSING'])
      .then((depth) => metrics.setGauge('fms_processing_queue_depth', {}, depth))
      .catch(() => {});
  }, 15_000);

  logger.info('All FMS workers started', {
    count: workers.length,
    mode: config.workerMode,
  });

  return {
    stop() {
      clearInterval(metricsTimer);
      for (const w of workers) w.stop();
    },
  };
}
