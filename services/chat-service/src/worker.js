import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as outboxWorker from './workers/outbox.worker.js';
import * as notificationWorker from './workers/notification.worker.js';
import * as cleanupWorker from './workers/cleanup.worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason) => {
  console.warn('[chat-worker] Unhandled rejection (non-fatal):', reason?.message || reason);
});

console.log('[chat-worker] Starting background worker process...');

async function start() {
  try {
    // 1. Start the Outbox Publisher (polls DB → publishes to Kafka)
    await outboxWorker.start();
    console.log('[chat-worker] Outbox publisher started.');

    // 2. Start the Notification Dispatcher
    await notificationWorker.start();
    console.log('[chat-worker] Notification dispatcher started.');

    // 3. Start the Cleanup Worker
    await cleanupWorker.start();
    console.log('[chat-worker] Cleanup worker started.');

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
  await notificationWorker.stop();
  cleanupWorker.stop();

  // Give in-flight operations 5s to finish
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
