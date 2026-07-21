import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import { requestId } from './api/middleware/requestId.middleware.js';
import fileRoutes from './api/routes/file.routes.js';
import chunkRoutes from './api/routes/chunk.routes.js';
import { startWorkers } from './workers/index.js';
import { startKafkaConsumers } from './infrastructure/queue/KafkaConsumer.js';
import { StorageFactory } from './infrastructure/storage/StorageFactory.js';
import { ensureBucketExists } from './config/minio.js';
import { getRedisClient, closeRedisClient } from './config/redis.config.js';
import { metrics } from './infrastructure/metrics/metrics.js';
import prisma from './config/database.js';
import config from './config/index.js';
import Logger from '../../../shared/common/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const logger = new Logger('file-service');

process.on('unhandledRejection', (reason) => {
  logger.warn('Unhandled promise rejection (non-fatal)', {
    reason: reason?.message || String(reason),
  });
});

const app = express();

app.use(express.json());
app.use(requestId);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'file-service',
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', async (_req, res) => {
  const checks = { db: false, storage: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    /* not ready */
  }

  try {
    const storage = StorageFactory.getInstance();
    await storage.exists('__healthcheck__');
    checks.storage = true;
  } catch {
    /* not ready */
  }

  try {
    const redis = getRedisClient();
    if (redis.status !== 'ready') await redis.connect().catch(() => {});
    await redis.ping();
    checks.redis = true;
  } catch {
    /* not ready */
  }

  const allReady = Object.values(checks).every(Boolean);
  res.status(allReady ? 200 : 503).json({
    ready: allReady,
    checks,
    service: 'file-service',
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.toPrometheus());
});

app.use('/files', fileRoutes);
app.use('/uploads', chunkRoutes);
app.use(errorHandler);

let workerHandle = null;

async function startServer() {
  if (config.storage.provider === 'minio') {
    try {
      await ensureBucketExists();
    } catch (err) {
      logger.warn('MinIO bucket initialization failed — service will start but uploads may fail', {
        error: err.message,
      });
    }
  }

  await startKafkaConsumers().catch((err) =>
    logger.warn('Kafka consumers failed to start', { error: err.message })
  );

  // Embedded workers only when not running a separate workers container
  if (config.workerMode === 'embedded') {
    workerHandle = startWorkers();
  }

  app.listen(config.port, () => {
    logger.info(`File Service started`, {
      port: config.port,
      storage: config.storage.provider,
      virusScan: config.virusScan.enabled,
      workerMode: config.workerMode,
      nodeEnv: config.nodeEnv,
    });
  });
}

startServer().catch((err) => {
  logger.error('Failed to start File Service', { error: err.message });
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  if (workerHandle) workerHandle.stop();
  await closeRedisClient();
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
