import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import { requestId } from './api/middleware/requestId.middleware.js';
import fileRoutes from './api/routes/file.routes.js';
import chunkRoutes from './api/routes/chunk.routes.js';
import { ExpiredChunkWorker } from './workers/ExpiredChunkWorker.js';
import { StorageFactory } from './infrastructure/storage/StorageFactory.js';
import { ensureBucketExists } from './config/minio.js';
import { getRedisClient, closeRedisClient } from './config/redis.config.js';
import prisma from './config/database.js';
import config from './config/index.js';
import Logger from '../../../shared/common/logger.js';

// Load .env from service directory (same pattern as all other IACMS services)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const logger = new Logger('file-service');

process.on('unhandledRejection', (reason) => {
  logger.warn('Unhandled promise rejection (non-fatal)', {
    reason: reason?.message || String(reason),
  });
});

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(requestId);

// ── Health (no auth required) ─────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'file-service',
    timestamp: new Date().toISOString(),
  });
});

// ── Readiness (checks DB + Storage + Redis) ───────────────────────────────────
app.get('/ready', async (_req, res) => {
  const checks = { db: false, storage: false, redis: false };

  // Database
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    /* not ready */
  }

  // Storage (MinIO ping or local filesystem check)
  try {
    const storage = StorageFactory.getInstance();
    // exists() returns false for missing files but true connection means storage is healthy
    await storage.exists('__healthcheck__');
    checks.storage = true;
  } catch {
    /* not ready */
  }

  // Redis
  try {
    const redis = getRedisClient();
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

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/files',   fileRoutes);
app.use('/uploads', chunkRoutes);

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────────────────────
async function startServer() {
  // Initialize storage bucket if using MinIO
  if (config.storage.provider === 'minio') {
    try {
      await ensureBucketExists();
    } catch (err) {
      logger.warn('MinIO bucket initialization failed — service will start but uploads may fail', {
        error: err.message,
      });
    }
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

// ── Workers (embedded mode only) ──────────────────────────────────────────
let expiredChunkWorker = null;

if (config.workerMode === 'embedded') {
  expiredChunkWorker = new ExpiredChunkWorker();
  expiredChunkWorker.start();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  if (expiredChunkWorker) expiredChunkWorker.stop();
  await closeRedisClient();
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
