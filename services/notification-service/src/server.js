import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import notificationRoutes from './routes/notification.routes.js';
import Logger from '../../../shared/common/logger.js';
import EventBus from '../../../shared/utils/eventBus.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3008;
const logger = new Logger('notification-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() });
});

// Subscribe to notification events
const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');
eventBus.subscribe('user.created', (data) => {
  logger.info('Sending welcome email', data);
});
eventBus.subscribe('case.created', (data) => {
  logger.info('Sending case creation notification', data);
});
eventBus.subscribe('case.assigned', (data) => {
  logger.info('Sending assignment notification', data);
});

app.use('/notifications', notificationRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Notification Service running on port ${PORT}`);
});

export default app;

