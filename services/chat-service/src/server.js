import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import Logger from '../../../shared/common/logger.js';
import { requireInternalRequest } from '../../../shared/middleware/requireInternalRequest.js';
import { assertProductionSecrets } from '../../../shared/utils/validateProductionSecrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason) => {
  console.warn('[chat-service] Unhandled rejection (non-fatal):', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 3009;
const logger = new Logger('chat-service');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// setupSwagger(app, 'Chat Service', PORT);

// Health endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'chat-service',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'alive' });
});

app.get('/health/ready', (req, res) => {
  // TODO: Check DB and Redis connectivity
  res.json({ status: 'ready' });
});

assertProductionSecrets([
  { name: 'JWT_SECRET', value: process.env.JWT_SECRET },
  { name: 'INTERNAL_SERVICE_TOKEN', value: process.env.INTERNAL_SERVICE_TOKEN },
]);

app.use(requireInternalRequest());

import conversationRoutes from './modules/conversations/conversation.routes.js';

// ... other imports if any

app.use('/conversations', conversationRoutes);

app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`[chat-service] REST API running on port ${PORT}`);
});

// Setup WebSocket server (to be implemented)
// import { initWebSocketServer } from './websocket/ws.server.js';
// initWebSocketServer(server);

export default app;
