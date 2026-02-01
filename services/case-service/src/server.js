import express from 'express';
import dotenv from 'dotenv';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import caseRoutes from './routes/case.routes.js';
import assignmentRoutes from './routes/assignment.routes.js';
import attachmentRoutes from './routes/attachment.routes.js';
import Logger from '../../../shared/common/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;
const logger = new Logger('case-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'case-service', timestamp: new Date().toISOString() });
});

app.use('/cases', caseRoutes);
app.use('/assignments', assignmentRoutes);
app.use('/attachments', attachmentRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Case Service running on port ${PORT}`);
});

export default app;

