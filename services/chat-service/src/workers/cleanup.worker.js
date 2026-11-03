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

    // 2. Clean up outbox events:
    // - Successfully published events older than 7 days
    // - Failed events older than 14 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const deletedPublished = await prisma.chatOutboxEvent.deleteMany({
      where: {
        status: 'PUBLISHED',
        publishedAt: {
          not: null,
          lt: sevenDaysAgo,
        },
      },
    });

    const deletedFailed = await prisma.chatOutboxEvent.deleteMany({
      where: {
        status: 'FAILED',
        createdAt: {
          lt: fourteenDaysAgo,
        },
      },
    });
    
    console.log(
      `[cleanup-worker] Cleaned up outbox events: ${deletedPublished.count} published, ${deletedFailed.count} failed.`
    );

  } catch (err) {
    console.error('[cleanup-worker] Error during cleanup:', err.message);
  }
}
