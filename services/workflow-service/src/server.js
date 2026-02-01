import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import workflowRoutes from './routes/workflow.routes.js';
import Logger from '../../../shared/common/logger.js';
import './config/database.js'; // Initialize database connection

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3004;
const logger = new Logger('workflow-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'workflow-service', timestamp: new Date().toISOString() });
});

app.use('/workflows', workflowRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Workflow Service running on port ${PORT}`);
});

export default app;

