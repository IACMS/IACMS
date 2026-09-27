import prisma from '../config/database.js';
import { producer, TOPICS } from '../config/kafka.js';

const POLL_INTERVAL_MS = parseInt(process.env.OUTBOX_POLL_INTERVAL_MS, 10) || 500;
const BATCH_SIZE = parseInt(process.env.OUTBOX_BATCH_SIZE, 10) || 50;
const MAX_RETRIES = 5;

let isRunning = false;
let pollTimer = null;

/**
 * Outbox Publisher Worker
 *
 * Polls the ChatOutboxEvent table for PENDING events, marks them PUBLISHING,
 * sends them to Kafka, and marks them PUBLISHED. If sending fails, the event
 * is marked FAILED with a retry counter.
 *
 * This guarantees at-least-once delivery: if the process crashes between
 * marking PUBLISHING and PUBLISHED, the event will be retried on next start.
 */
export async function start() {
  if (isRunning) return;
  isRunning = true;

  console.log(`[outbox-worker] Starting outbox publisher (poll every ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE})`);

  await producer.connect();
  poll();
}

export function stop() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[outbox-worker] Stopped.');
}

async function poll() {
  if (!isRunning) return;

  try {
    await processBatch();
  } catch (error) {
    console.error('[outbox-worker] Poll cycle error:', error.message);
  }

  // Schedule next poll
  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

async function processBatch() {
  // 1. Claim a batch of PENDING events by setting status → PUBLISHING
  const events = await prisma.chatOutboxEvent.findMany({
    where: {
      status: 'PENDING',
      retryCount: { lt: MAX_RETRIES },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (events.length === 0) return;

  // Mark all as PUBLISHING atomically
  const eventIds = events.map((e) => e.id);
  await prisma.chatOutboxEvent.updateMany({
    where: { id: { in: eventIds }, status: 'PENDING' },
    data: { status: 'PUBLISHING' },
  });

  // 2. Build Kafka messages grouped by topic
  const kafkaMessages = events.map((event) => {
    const topic = mapEventTypeToTopic(event.eventType);
    return {
      topic,
      messages: [
        {
          key: event.payload.conversationId || event.id,
          value: JSON.stringify({
            eventId: event.id,
            eventType: event.eventType,
            ...event.payload,
            publishedAt: new Date().toISOString(),
          }),
          headers: {
            eventType: event.eventType,
          },
        },
      ],
    };
  });

  // 3. Send to Kafka
  const succeeded = [];
  const failed = [];

  for (const msg of kafkaMessages) {
    const eventId = events.find((e) => mapEventTypeToTopic(e.eventType) === msg.topic)?.id;
    try {
      await producer.send(msg);
      succeeded.push(eventId);
    } catch (error) {
      console.error(`[outbox-worker] Failed to publish event ${eventId}:`, error.message);
      failed.push(eventId);
    }
  }

  // 4. Mark succeeded as PUBLISHED
  if (succeeded.length > 0) {
    await prisma.chatOutboxEvent.updateMany({
      where: { id: { in: succeeded } },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }

  // 5. Mark failed — increment retry counter
  if (failed.length > 0) {
    for (const id of failed) {
      await prisma.chatOutboxEvent.update({
        where: { id },
        data: {
          status: 'PENDING', // back to PENDING for retry
          retryCount: { increment: 1 },
          lastErrorAt: new Date(),
        },
      });
    }
  }

  if (succeeded.length > 0 || failed.length > 0) {
    console.log(
      `[outbox-worker] Batch: ${succeeded.length} published, ${failed.length} failed`
    );
  }
}

/**
 * Map our internal event types to Kafka topic names.
 */
function mapEventTypeToTopic(eventType) {
  const mapping = {
    CHAT_MESSAGE_CREATED: TOPICS.CHAT_MESSAGE_CREATED,
    CHAT_MESSAGE_UPDATED: TOPICS.CHAT_MESSAGE_UPDATED,
    CHAT_MESSAGE_DELETED: TOPICS.CHAT_MESSAGE_DELETED,
  };
  return mapping[eventType] || 'chat.events.unknown';
}

/**
 * Cleanup old published events (run periodically from cron).
 */
export async function cleanupPublishedEvents(olderThanDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const { count } = await prisma.chatOutboxEvent.deleteMany({
    where: {
      status: 'PUBLISHED',
      publishedAt: { lt: cutoff },
    },
  });

  if (count > 0) {
    console.log(`[outbox-worker] Cleaned up ${count} published events older than ${olderThanDays} days`);
  }
}
