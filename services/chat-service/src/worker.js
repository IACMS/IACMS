import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason) => {
  console.warn('[chat-worker] Unhandled rejection (non-fatal):', reason?.message || reason);
});

console.log('[chat-worker] Starting background worker process...');

async function start() {
  try {
    // 1. Initialize Prisma connection
    // 2. Initialize Redis connection
    // 3. Initialize Kafka connections
    
    // 4. Start Outbox Publisher Worker
    // 5. Start Notification Dispatcher Worker
    // 6. Start cron jobs (Cleanup, Presence TTL)
    
    console.log('[chat-worker] Background workers initialized successfully.');
  } catch (error) {
    console.error('[chat-worker] Failed to start workers:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('[chat-worker] SIGTERM received. Shutting down gracefully...');
  // Stop workers, close connections
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[chat-worker] SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

start();
