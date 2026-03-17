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
} from './consumers/email.consumer.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3008;
const logger = new Logger('notification-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() });
});

// ── Kafka event subscriptions ─────────────────────────────────────────────────
const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'notification-service');

// Auth events → email notifications
eventBus.subscribe(TOPICS.USER_CREATED, handleUserCreated);
eventBus.subscribe(TOPICS.PASSWORD_RESET_REQUESTED, handlePasswordResetRequested);
eventBus.subscribe(TOPICS.PASSWORD_CHANGED, handlePasswordChanged);
eventBus.subscribe(TOPICS.EMAIL_VERIFICATION_REQUESTED, handleEmailVerificationRequested);

// Case / workflow / referral events (stub handlers — real templates to be added later)
eventBus.subscribe(TOPICS.CASE_CREATED, (data) => {
  logger.info('Case creation notification pending implementation', { caseId: data?.id });
});
eventBus.subscribe(TOPICS.CASE_ASSIGNED, (data) => {
  logger.info('Case assignment notification pending implementation', { caseId: data?.id });
});
eventBus.subscribe(TOPICS.CASE_UPDATED, (data) => {
  logger.info('Case update notification pending implementation', { caseId: data?.id });
});
eventBus.subscribe(TOPICS.WORKFLOW_STATE_CHANGED, (data) => {
  logger.info('Workflow state change notification pending implementation', { workflowId: data?.workflowId });
});
eventBus.subscribe(TOPICS.REFERRAL_CREATED, (data) => {
  logger.info('Referral created notification pending implementation', { referralId: data?.id });
});
eventBus.subscribe(TOPICS.REFERRAL_ACCEPTED, (data) => {
  logger.info('Referral accepted notification pending implementation', { referralId: data?.id });
});
eventBus.subscribe(TOPICS.REFERRAL_REJECTED, (data) => {
  logger.info('Referral rejected notification pending implementation', { referralId: data?.id });
});

app.use('/notifications', notificationRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Notification Service running on port ${PORT}`);
});

export default app;
