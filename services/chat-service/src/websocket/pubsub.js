import { redisPub, redisSub } from '../config/redis.js';
import * as registry from './connection.registry.js';

const CHANNEL = 'chat:pubsub';

let isSubscribed = false;

/**
 * Redis Pub/Sub bridge for multi-instance WebSocket delivery.
 *
 * When the chat-service runs multiple replicas (horizontal scaling), a message
 * published from instance A must reach WebSocket clients connected to instance B.
 *
 * Flow:
 *   1. Instance A calls `publish(event)` → writes to Redis channel
 *   2. All instances (including A) receive the event via `redisSub`
 *   3. Each instance broadcasts to its local WebSocket connections
 *
 * This is a standard Redis Pub/Sub fan-out pattern used by Socket.io, ActionCable, etc.
 */

export async function subscribe() {
  if (isSubscribed) return;

  await redisSub.subscribe(CHANNEL);
  isSubscribed = true;

  redisSub.on('message', (channel, rawMessage) => {
    if (channel !== CHANNEL) return;

    try {
      const event = JSON.parse(rawMessage);
      handleIncomingEvent(event);
    } catch (err) {
      console.error('[pubsub] Failed to parse event:', err.message);
    }
  });

  console.log('[pubsub] Subscribed to Redis Pub/Sub channel:', CHANNEL);
}

/**
 * Publish an event to all chat-service instances via Redis.
 */
export async function publish(event) {
  const payload = JSON.stringify(event);
  await redisPub.publish(CHANNEL, payload);
}

/**
 * Handle an event received from Redis Pub/Sub.
 * Routes the event to the appropriate local WebSocket connections.
 */
function handleIncomingEvent(event) {
  switch (event.type) {
    case 'MESSAGE_CREATED':
    case 'MESSAGE_UPDATED':
    case 'MESSAGE_DELETED':
    case 'REACTION_ADDED':
    case 'REACTION_REMOVED':
      // Broadcast to all members subscribed to this conversation
      registry.broadcastToConversation(event.conversationId, {
        type: event.type,
        data: event.data,
      });
      break;

    case 'TYPING_START':
    case 'TYPING_STOP':
      // Broadcast to conversation but exclude the typer themselves
      registry.broadcastToConversation(
        event.conversationId,
        { type: event.type, data: event.data },
        event.data.userId
      );
      break;

    case 'PRESENCE_CHANGE':
      // Send presence updates to all users who share a conversation with this user
      // For simplicity, broadcast to all connections of each affected conversation
      if (event.conversationIds) {
        for (const convId of event.conversationIds) {
          registry.broadcastToConversation(convId, {
            type: 'PRESENCE_CHANGE',
            data: event.data,
          });
        }
      }
      break;

    case 'READ_RECEIPT':
      registry.broadcastToConversation(event.conversationId, {
        type: 'READ_RECEIPT',
        data: event.data,
      });
      break;

    case 'PARTICIPANT_ADDED':
    case 'PARTICIPANT_REMOVED':
      registry.broadcastToConversation(event.conversationId, {
        type: event.type,
        data: event.data,
      });
      break;

    default:
      console.warn('[pubsub] Unknown event type:', event.type);
  }
}
