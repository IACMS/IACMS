import EventBus from '../../../../shared/utils/eventBus.js';

/** Single broker client for workflow-service (avoid duplicate Kafka clients per module). */
export const workflowEventBus = new EventBus(
  process.env.KAFKA_BROKERS || 'localhost:9092',
  'workflow-service',
);
