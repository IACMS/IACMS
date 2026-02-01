import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import integrationRoutes from './routes/integration.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import Logger from '../../../shared/common/logger.js';
import './config/database.js'; // Initialize database connection

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3007;
const logger = new Logger('integration-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'integration-service', timestamp: new Date().toISOString() });
});

app.use('/integrations', integrationRoutes);
app.use('/webhooks', webhookRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Integration Service running on port ${PORT}`);
});

export default app;

