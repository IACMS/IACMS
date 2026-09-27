import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as outboxWorker from './workers/outbox.worker.js';
import { cleanupPublishedEvents } from './workers/outbox.worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason) => {
  console.warn('[chat-worker] Unhandled rejection (non-fatal):', reason?.message || reason);
});

console.log('[chat-worker] Starting background worker process...');

// Cleanup cron interval (default: every 6 hours)
const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS, 10) || 6 * 60 * 60 * 1000;
let cleanupTimer = null;

async function start() {
  try {
    // 1. Start the Outbox Publisher (polls DB → publishes to Kafka)
    await outboxWorker.start();
    console.log('[chat-worker] Outbox publisher started.');

    // 2. Schedule periodic cleanup of old published outbox events
    cleanupTimer = setInterval(async () => {
      try {
        await cleanupPublishedEvents(7);
      } catch (err) {
        console.error('[chat-worker] Cleanup error:', err.message);
      }
    }, CLEANUP_INTERVAL_MS);

    console.log('[chat-worker] Background workers initialized successfully.');
  } catch (error) {
    console.error('[chat-worker] Failed to start workers:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
async function shutdown(signal) {
  console.log(`[chat-worker] ${signal} received. Shutting down gracefully...`);

  outboxWorker.stop();

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  // Give in-flight operations 5s to finish
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
