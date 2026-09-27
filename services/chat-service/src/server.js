import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import Logger from '../../../shared/common/logger.js';
import { requireInternalRequest } from '../../../shared/middleware/requireInternalRequest.js';
import { assertProductionSecrets } from '../../../shared/utils/validateProductionSecrets.js';

// Route imports
import conversationRoutes from './modules/conversations/conversation.routes.js';
import messageRoutes from './modules/messages/message.routes.js';
import participantRoutes from './modules/participants/participant.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

process.on('unhandledRejection', (reason) => {
  console.warn('[chat-service] Unhandled rejection (non-fatal):', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 3010;
const logger = new Logger('chat-service');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health endpoints (before auth middleware — must be publicly reachable)
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

// ── Routes ──────────────────────────────────────────────────────────────
app.use('/conversations', conversationRoutes);
app.use('/conversations/:id/messages', messageRoutes);
app.use('/conversations/:id/participants', participantRoutes);

// Global error handler
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`[chat-service] REST API running on port ${PORT}`);
});

// Setup WebSocket server (Sprint 4)
// import { initWebSocketServer } from './websocket/ws.server.js';
// initWebSocketServer(server);

export { server };
export default app;
