/**
 * Standalone workers entrypoint (WORKER_MODE=standalone).
 * Used by the file-service-workers container — no HTTP server.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { startWorkers } from './index.js';
import { startKafkaConsumers } from '../infrastructure/queue/KafkaConsumer.js';
import { ensureBucketExists } from '../config/minio.js';
import { closeRedisClient } from '../config/redis.config.js';
import prisma from '../config/database.js';
import config from '../config/index.js';
import Logger from '../../../../shared/common/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../..', '.env') });

const logger = new Logger('file-service-workers');

async function main() {
  if (config.storage.provider === 'minio') {
    try {
      await ensureBucketExists();
    } catch (err) {
      logger.warn('MinIO bucket init failed', { error: err.message });
    }
  }

  await startKafkaConsumers().catch((err) =>
    logger.warn('Kafka consumers failed to start', { error: err.message })
  );

  const handle = startWorkers();

  logger.info('File Service workers running (standalone)', {
    storage: config.storage.provider,
    virusScan: config.virusScan.enabled,
  });

  const shutdown = async () => {
    logger.info('Shutting down workers');
    handle.stop();
    await closeRedisClient();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('Workers failed to start', { error: err.message });
  process.exit(1);
});
