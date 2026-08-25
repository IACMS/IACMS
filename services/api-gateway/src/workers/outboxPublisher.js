import prisma from '../config/database.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('outbox-publisher');
const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;

let eventBus = null;
let intervalId = null;

async function publishPendingRecords() {
  try {
    const records = await prisma.auditOutbox.findMany({
      where: { published: false },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    if (records.length === 0) return;

    for (const record of records) {
      try {
        if (eventBus) {
          await eventBus.publish(TOPICS.AUDIT_LOG, record.payload);
        }
        await prisma.auditOutbox.update({
          where: { id: record.id },
          data: { published: true, publishedAt: new Date() },
        });
      } catch (err) {
        logger.error('Failed to publish outbox record', { id: record.id, error: err.message });
      }
    }

    logger.info('Published outbox records', { count: records.length });
  } catch (err) {
    logger.error('Outbox publisher error', { error: err.message });
  }
}

export function startOutboxPublisher() {
  const kafkaBrokers = process.env.KAFKA_BROKERS || 'localhost:9092';
  try {
    eventBus = new EventBus(kafkaBrokers, 'api-gateway-outbox');
    logger.info('Outbox publisher Kafka connection initialized');
  } catch (err) {
    logger.warn('Kafka not available for outbox publisher, records will accumulate', { error: err.message });
  }

  intervalId = setInterval(publishPendingRecords, POLL_INTERVAL_MS);
  logger.info('Outbox publisher started', { pollIntervalMs: POLL_INTERVAL_MS });
}

export function stopOutboxPublisher() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  logger.info('Outbox publisher stopped');
}
