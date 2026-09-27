import { WebSocketServer } from 'ws';
import { authenticateWsRequest } from './ws.auth.js';
import * as presence from './presence.js';
import * as pubsub from './pubsub.js';
import * as registry from './connection.registry.js';
import prisma from '../config/database.js';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10_000;  // 10 seconds to respond

/**
 * Initialize the WebSocket server on the same HTTP server as Express.
 *
 * Protocol:
 *   Client → Server (JSON):
 *     { action: "subscribe",   conversationId: "uuid" }
 *     { action: "unsubscribe", conversationId: "uuid" }
 *     { action: "typing",      conversationId: "uuid", isTyping: true|false }
 *     { action: "focus",       conversationId: "uuid" | null }
 *     { action: "pong" }
 *
 *   Server → Client (JSON):
 *     { type: "MESSAGE_CREATED",  data: { ... } }
 *     { type: "MESSAGE_UPDATED",  data: { ... } }
 *     { type: "MESSAGE_DELETED",  data: { ... } }
 *     { type: "TYPING_START",     data: { conversationId, userId, firstName } }
 *     { type: "TYPING_STOP",      data: { conversationId, userId } }
 *     { type: "PRESENCE_CHANGE",  data: { userId, isOnline } }
 *     { type: "READ_RECEIPT",     data: { conversationId, userId, messageId } }
 *     { type: "SUBSCRIBED",       data: { conversationId } }
 *     { type: "ERROR",            data: { message } }
 *     { type: "ping" }
 */
export function initWebSocketServer(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    // Verify JWT on the HTTP upgrade before accepting
    verifyClient: (info, callback) => {
      const user = authenticateWsRequest(info.req);
      if (!user) {
        callback(false, 401, 'Unauthorized');
        return;
      }
      // Attach user to the request so we can read it in `connection` handler
      info.req._wsUser = user;
      callback(true);
    },
  });

  // Start Redis Pub/Sub listener
  pubsub.subscribe();

  // Heartbeat — detect dead connections
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws._isAlive === false) {
        // Didn't respond to the last ping — terminate
        return ws.terminate();
      }
      ws._isAlive = false;
      ws.send(JSON.stringify({ type: 'ping' }));
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(heartbeatTimer));

  wss.on('connection', async (ws, req) => {
    const user = req._wsUser;
    ws._user = user;
    ws._isAlive = true;

    // Register this connection
    registry.addUserConnection(user.userId, ws);

    // Mark user as online in Redis
    await presence.setOnline(user.userId);

    // Notify presence change to relevant conversations
    await broadcastPresenceChange(user.userId, true);

    console.log(`[ws] Connected: ${user.firstName} ${user.lastName} (${user.userId})`);

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      data: {
        userId: user.userId,
        message: 'WebSocket connection established',
      },
    }));

    // ── Message handler ────────────────────────────────────────────────
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await handleClientMessage(ws, user, msg);
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          data: { message: 'Invalid message format' },
        }));
      }
    });

    // ── Disconnect handler ─────────────────────────────────────────────
    ws.on('close', async () => {
      registry.unsubscribeFromAll(ws);
      registry.removeUserConnection(user.userId, ws);

      // Only mark offline if this was the user's last connection
      if (!registry.isUserConnected(user.userId)) {
        await presence.setOffline(user.userId);
        await presence.setActiveConversation(user.userId, null);
        await broadcastPresenceChange(user.userId, false);
      }

      console.log(`[ws] Disconnected: ${user.userId}`);
    });

    ws.on('error', (err) => {
      console.error(`[ws] Error for user ${user.userId}:`, err.message);
    });
  });

  console.log(`[ws] WebSocket server initialized on path /ws`);
  return wss;
}

/**
 * Route incoming client messages to the appropriate handler.
 */
async function handleClientMessage(ws, user, msg) {
  switch (msg.action) {
    case 'subscribe':
      await handleSubscribe(ws, user, msg.conversationId);
      break;

    case 'unsubscribe':
      handleUnsubscribe(ws, msg.conversationId);
      break;

    case 'typing':
      await handleTyping(ws, user, msg.conversationId, msg.isTyping);
      break;

    case 'focus':
      await handleFocus(user, msg.conversationId);
      break;

    case 'pong':
      ws._isAlive = true;
      // Refresh presence TTL on heartbeat response
      await presence.setOnline(user.userId);
      break;

    default:
      ws.send(JSON.stringify({
        type: 'ERROR',
        data: { message: `Unknown action: ${msg.action}` },
      }));
  }
}

/**
 * Subscribe to a conversation's real-time events.
 * Verifies the user is an active participant before allowing.
 */
async function handleSubscribe(ws, user, conversationId) {
  if (!conversationId) {
    ws.send(JSON.stringify({ type: 'ERROR', data: { message: 'conversationId required' } }));
    return;
  }

  // Authorization check — is user an active participant?
  const participant = await prisma.chatParticipant.findFirst({
    where: {
      conversationId,
      userId: user.userId,
      leftAt: null,
      conversation: { tenantId: user.tenantId },
    },
  });

  if (!participant) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      data: { message: 'Not a participant in this conversation' },
    }));
    return;
  }

  registry.subscribeToConversation(conversationId, ws);

  ws.send(JSON.stringify({
    type: 'SUBSCRIBED',
    data: { conversationId },
  }));
}

function handleUnsubscribe(ws, conversationId) {
  if (conversationId) {
    registry.unsubscribeFromConversation(conversationId, ws);
  }
}

/**
 * Handle typing indicator — broadcast via Redis Pub/Sub.
 */
async function handleTyping(ws, user, conversationId, isTyping) {
  if (!conversationId) return;

  await pubsub.publish({
    type: isTyping ? 'TYPING_START' : 'TYPING_STOP',
    conversationId,
    data: {
      conversationId,
      userId: user.userId,
      firstName: user.firstName,
    },
  });
}

/**
 * Track which conversation the user is actively viewing.
 */
async function handleFocus(user, conversationId) {
  await presence.setActiveConversation(user.userId, conversationId || null);
}

/**
 * Broadcast a user's online/offline status to all conversations they belong to.
 */
async function broadcastPresenceChange(userId, isOnline) {
  // Find all conversations this user participates in
  const participations = await prisma.chatParticipant.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true },
  });

  if (participations.length === 0) return;

  const conversationIds = participations.map((p) => p.conversationId);

  await pubsub.publish({
    type: 'PRESENCE_CHANGE',
    conversationIds,
    data: { userId, isOnline },
  });
}
