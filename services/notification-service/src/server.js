import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import notificationRoutes from './routes/notification.routes.js';
import Logger from '../../../shared/common/logger.js';
import { setupSwagger } from '../../../shared/swagger.js';
import EventBus, { TOPICS } from '../../../shared/utils/eventBus.js';
import {
  handleUserCreated,
  handlePasswordResetRequested,
  handlePasswordChanged,
  handleEmailVerificationRequested,
  handleTenantApproved,
} from './consumers/email.consumer.js';

dotenv.config();

// Prevent KafkaJS retry overflows or other async errors from killing the process
process.on('unhandledRejection', (reason) => {
  console.warn('[notification-service] Unhandled rejection (non-fatal):', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 3008;
const logger = new Logger('notification-service');

app.use(express.json());

// Setup Swagger OpenAPI Documentation
setupSwagger(app, 'Notification Service', PORT);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() });
});

// ── Kafka event subscriptions ─────────────────────────────────────────────────
const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'notification-service');

async function registerSubscriptions() {
  // IMPORTANT:
  // KafkaJS requires all topic subscriptions to be registered BEFORE consumer.run() starts.
  // So we register all subscriptions synchronously (same tick) and then await them together.
  const subscriptions = [
    // Auth events → email notifications
    eventBus.subscribe(TOPICS.USER_CREATED, handleUserCreated),
    eventBus.subscribe(TOPICS.PASSWORD_RESET_REQUESTED, handlePasswordResetRequested),
    eventBus.subscribe(TOPICS.PASSWORD_CHANGED, handlePasswordChanged),
    eventBus.subscribe(TOPICS.EMAIL_VERIFICATION_REQUESTED, handleEmailVerificationRequested),
    eventBus.subscribe(TOPICS.TENANT_APPROVED, handleTenantApproved),

    // Case / workflow / referral events (stub handlers — real templates to be added later)
    eventBus.subscribe(TOPICS.CASE_CREATED, (data) => {
      logger.info('Case creation notification pending implementation', { caseId: data?.id });
    }),
    eventBus.subscribe(TOPICS.CASE_ASSIGNED, (data) => {
      logger.info('Case assignment notification pending implementation', { caseId: data?.id });
    }),
    eventBus.subscribe(TOPICS.CASE_UPDATED, (data) => {
      logger.info('Case update notification pending implementation', { caseId: data?.id });
    }),
    eventBus.subscribe(TOPICS.CASE_TRANSITIONED, (data) => {
      logger.info('Case transition notification pending implementation', {
        caseId: data?.caseId,
        transitionId: data?.transitionId,
      });
    }),
    eventBus.subscribe(TOPICS.REFERRAL_CREATED, (data) => {
      logger.info('Referral created notification pending implementation', { referralId: data?.id });
    }),
    eventBus.subscribe(TOPICS.REFERRAL_ACCEPTED, (data) => {
      logger.info('Referral accepted notification pending implementation', { referralId: data?.id });
    }),
    eventBus.subscribe(TOPICS.REFERRAL_REJECTED, (data) => {
      logger.info('Referral rejected notification pending implementation', { referralId: data?.id });
    }),
  ];

  await Promise.all(subscriptions);
}

registerSubscriptions().catch(err =>
  logger.warn('Kafka subscriptions failed to initialize — service will still handle HTTP requests', { error: err.message })
);

// Log when the Kafka consumer becomes active (helps debug missed emails after Kafka starts late)
setInterval(() => {
  if (eventBus.consumerConnected) return;
  logger.warn('Kafka consumer not connected — notification emails will not be sent until Kafka is reachable');
}, 60_000).unref();

app.use('/notifications', notificationRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Notification Service running on port ${PORT}`);
});

export default app;
