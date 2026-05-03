/**
 * Express app for workflow route tests (no listen(), avoids clashing with dev server on 3004).
 */
import express from 'express';
import { errorHandler } from '../../../../shared/middleware/errorHandler.js';
import '../../src/config/database.js';
import workflowRoutes from '../../src/routes/workflow.routes.js';

const app = express();
app.use(express.json());
app.use('/workflows', workflowRoutes);
app.use(errorHandler);

export default app;
