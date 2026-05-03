import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import notificationRoutes from './routes/notification.routes.js';
import Logger from '../../../shared/common/logger.js';
import EventBus, { TOPICS } from '../../../shared/utils/eventBus.js';
import {
  handleUserCreated,
  handlePasswordResetRequested,
  handlePasswordChanged,
  handleEmailVerificationRequested,
  handleCaseCreated,
  handleCaseAssigned,
  handleCaseUpdated,
  handleWorkflowStateChanged,
  handleReferralCreated,
  handleReferralAccepted,
  handleReferralRejected,
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

    eventBus.subscribe(TOPICS.CASE_CREATED, handleCaseCreated),
    eventBus.subscribe(TOPICS.CASE_ASSIGNED, handleCaseAssigned),
    eventBus.subscribe(TOPICS.CASE_UPDATED, handleCaseUpdated),
    eventBus.subscribe(TOPICS.WORKFLOW_STATE_CHANGED, handleWorkflowStateChanged),
    eventBus.subscribe(TOPICS.REFERRAL_CREATED, handleReferralCreated),
    eventBus.subscribe(TOPICS.REFERRAL_ACCEPTED, handleReferralAccepted),
    eventBus.subscribe(TOPICS.REFERRAL_REJECTED, handleReferralRejected),
  ];

  await Promise.all(subscriptions);
}

registerSubscriptions().catch(err =>
  logger.warn('Kafka subscriptions failed to initialize — service will still handle HTTP requests', { error: err.message })
);

app.use('/notifications', notificationRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Notification Service running on port ${PORT}`);
});

export default app;
