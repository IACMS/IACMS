import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import caseRoutes from './routes/case.routes.js';
import assignmentRoutes from './routes/assignment.routes.js';
import attachmentRoutes from './routes/attachment.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import workflowRoutes from './routes/workflow.routes.js';
import referralRoutes from './routes/referral.routes.js';
import Logger from '../../../shared/common/logger.js';
import './config/database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;
const logger = new Logger('case-engine-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'case-engine-service', timestamp: new Date().toISOString() });
});

app.use('/cases', caseRoutes);
app.use('/assignments', assignmentRoutes);
app.use('/attachments', attachmentRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/workflows', workflowRoutes);
app.use('/referrals', referralRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Case Engine Service running on port ${PORT}`);
});

export default app;
