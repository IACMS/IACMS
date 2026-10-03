import prisma from '../config/database.js';

let intervalTimer = null;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily

export async function start() {
  if (intervalTimer) return;

  console.log('[cleanup-worker] Starting cleanup worker...');

  // Run immediately on start
  await runCleanup();

  // Then schedule it daily
  intervalTimer = setInterval(async () => {
    await runCleanup();
  }, CLEANUP_INTERVAL_MS);
}

export function stop() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  console.log('[cleanup-worker] Stopped.');
}

async function runCleanup() {
  try {
    console.log('[cleanup-worker] Running daily cleanup task...');
    
    // 1. Hard-delete messages soft-deleted >30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const deletedMessages = await prisma.chatMessage.deleteMany({
      where: {
        deletedAt: {
          not: null,
          lt: thirtyDaysAgo,
        },
      },
    });

    console.log(`[cleanup-worker] Hard-deleted ${deletedMessages.count} old soft-deleted messages.`);

    // 2. Clean up very old outbox events (failed ones > 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deletedEvents = await prisma.chatOutboxEvent.deleteMany({
      where: {
        status: 'FAILED',
        createdAt: {
          lt: sevenDaysAgo,
        },
      },
    });
    
    console.log(`[cleanup-worker] Cleaned up ${deletedEvents.count} old failed outbox events.`);

  } catch (err) {
    console.error('[cleanup-worker] Error during cleanup:', err.message);
  }
}
