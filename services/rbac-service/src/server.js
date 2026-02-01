import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import roleRoutes from './routes/role.routes.js';
import permissionRoutes from './routes/permission.routes.js';
import userRoleRoutes from './routes/user-role.routes.js';
import Logger from '../../../shared/common/logger.js';

// Load .env from service directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = 3002; // RBAC Service port
const logger = new Logger('rbac-service');

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'rbac-service', timestamp: new Date().toISOString() });
});

app.use('/roles', roleRoutes);
app.use('/permissions', permissionRoutes);
app.use('/user-roles', userRoleRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`RBAC Service running on port ${PORT}`);
});

export default app;

