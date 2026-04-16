import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import auditRoutes from './routes/audit.routes.js';
import Logger from '../../../shared/common/logger.js';
import EventBus, { TOPICS } from '../../../shared/utils/eventBus.js';
import { handleAuditLog } from './consumers/audit.consumer.js';
import './config/database.js'; // Initialize database connection

dotenv.config();

// Prevent any async Kafka errors from killing the process
process.on('unhandledRejection', (reason) => {
  console.warn('[audit-service] Unhandled rejection (non-fatal):', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 3006;
const logger = new Logger('audit-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'audit-service', timestamp: new Date().toISOString() });
});

// Subscribe to audit events and persist them to the database
const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'audit-service');
eventBus.subscribe(TOPICS.AUDIT_LOG, handleAuditLog).catch(err =>
  logger.warn('Kafka subscription failed — audit events will not be persisted until Kafka is available', { error: err.message })
);

app.use('/audit', auditRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Audit Service running on port ${PORT}`);
});

export default app;

