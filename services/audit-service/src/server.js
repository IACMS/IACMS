import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import auditRoutes from './routes/audit.routes.js';
import Logger from '../../../shared/common/logger.js';
import EventBus from '../../../shared/utils/eventBus.js';
import './config/database.js'; // Initialize database connection

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3006;
const logger = new Logger('audit-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'audit-service', timestamp: new Date().toISOString() });
});

// Subscribe to audit events
const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');
eventBus.subscribe('audit.log', async (data) => {
  // Handle audit log creation
  logger.info('Audit event received', data);
});

app.use('/audit', auditRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Audit Service running on port ${PORT}`);
});

export default app;

