import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import referralRoutes from './routes/referral.routes.js';
import Logger from '../../../shared/common/logger.js';
import './config/database.js'; // Initialize database connection

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;
const logger = new Logger('referral-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'referral-service', timestamp: new Date().toISOString() });
});

app.use('/referrals', referralRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Referral Service running on port ${PORT}`);
});

export default app;

