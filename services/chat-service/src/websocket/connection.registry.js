/**
 * Connection Registry
 *
 * In-memory map that tracks which WebSocket connections belong to which users
 * and which conversations they've subscribed to.
 *
 * Structure:
 *   userConnections:  Map<userId, Set<WebSocket>>
 *   conversationSubs: Map<conversationId, Set<WebSocket>>
 */

/** userId → Set<WebSocket> */
const userConnections = new Map();

/** conversationId → Set<WebSocket> */
const conversationSubs = new Map();

// ── User connections ─────────────────────────────────────────────────────

export function addUserConnection(userId, ws) {
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  userConnections.get(userId).add(ws);
}

export function removeUserConnection(userId, ws) {
  const conns = userConnections.get(userId);
  if (conns) {
    conns.delete(ws);
    if (conns.size === 0) {
      userConnections.delete(userId);
    }
  }
}

export function getUserConnections(userId) {
  return userConnections.get(userId) || new Set();
}

export function isUserConnected(userId) {
  const conns = userConnections.get(userId);
  return conns && conns.size > 0;
}

// ── Conversation subscriptions ───────────────────────────────────────────

export function subscribeToConversation(conversationId, ws) {
  if (!conversationSubs.has(conversationId)) {
    conversationSubs.set(conversationId, new Set());
  }
  conversationSubs.get(conversationId).add(ws);

  // Also track on the ws object for cleanup
  if (!ws._subscribedConversations) {
    ws._subscribedConversations = new Set();
  }
  ws._subscribedConversations.add(conversationId);
}

export function unsubscribeFromConversation(conversationId, ws) {
  const subs = conversationSubs.get(conversationId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) {
      conversationSubs.delete(conversationId);
    }
  }

  if (ws._subscribedConversations) {
    ws._subscribedConversations.delete(conversationId);
  }
}

export function unsubscribeFromAll(ws) {
  if (ws._subscribedConversations) {
    for (const convId of ws._subscribedConversations) {
      const subs = conversationSubs.get(convId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          conversationSubs.delete(convId);
        }
      }
    }
    ws._subscribedConversations.clear();
  }
}

/**
 * Send a message to all WebSocket connections subscribed to a conversation,
 * optionally excluding a specific user (e.g. the sender).
 */
export function broadcastToConversation(conversationId, data, excludeUserId = null) {
  const subs = conversationSubs.get(conversationId);
  if (!subs) return;

  const payload = typeof data === 'string' ? data : JSON.stringify(data);

  for (const ws of subs) {
    if (ws.readyState === 1 /* WebSocket.OPEN */) {
      if (excludeUserId && ws._user?.userId === excludeUserId) continue;
      ws.send(payload);
    }
  }
}

/**
 * Send a message directly to a specific user (all their connections).
 */
export function sendToUser(userId, data) {
  const conns = getUserConnections(userId);
  if (conns.size === 0) return;

  const payload = typeof data === 'string' ? data : JSON.stringify(data);

  for (const ws of conns) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

/**
 * Stats for monitoring / health checks.
 */
export function getStats() {
  let totalConnections = 0;
  for (const conns of userConnections.values()) {
    totalConnections += conns.size;
  }

  return {
    connectedUsers: userConnections.size,
    totalConnections,
    subscribedConversations: conversationSubs.size,
  };
}
