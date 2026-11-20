import { redis } from '../config/redis.js';

const PRESENCE_TTL = 120; // seconds — refreshed by heartbeat
const PRESENCE_KEY_PREFIX = 'chat:presence:';
const USER_CONVERSATIONS_PREFIX = 'chat:user_convos:';

/**
 * Mark a user as online with a TTL.
 * Called on WebSocket connect and on each heartbeat.
 */
export async function setOnline(userId) {
  await redis.setex(`${PRESENCE_KEY_PREFIX}${userId}`, PRESENCE_TTL, Date.now().toString());
}

/**
 * Mark a user as offline immediately.
 * Called on WebSocket disconnect.
 */
export async function setOffline(userId) {
  await redis.del(`${PRESENCE_KEY_PREFIX}${userId}`);
}

/**
 * Check if a user is currently online.
 */
export async function isOnline(userId) {
  const val = await redis.exists(`${PRESENCE_KEY_PREFIX}${userId}`);
  return val === 1;
}

/**
 * Get online status for a list of user IDs.
 * Returns a Map<userId, boolean>.
 */
export async function getBulkPresence(userIds) {
  if (!userIds.length) return new Map();

  const pipeline = redis.pipeline();
  for (const id of userIds) {
    pipeline.exists(`${PRESENCE_KEY_PREFIX}${id}`);
  }
  const results = await pipeline.exec();

  const presence = new Map();
  for (let i = 0; i < userIds.length; i++) {
    // pipeline.exec returns [[err, result], [err, result], ...]
    const [err, exists] = results[i];
    presence.set(userIds[i], !err && exists === 1);
  }
  return presence;
}

/**
 * Track which conversation a connected user is actively viewing.
 * Used so we can skip push notifications for messages the user is already reading.
 */
export async function setActiveConversation(userId, conversationId) {
  if (conversationId) {
    await redis.setex(`${USER_CONVERSATIONS_PREFIX}${userId}:active`, PRESENCE_TTL, conversationId);
  } else {
    await redis.del(`${USER_CONVERSATIONS_PREFIX}${userId}:active`);
  }
}

/**
 * Get which conversation a user is actively viewing (if any).
 */
export async function getActiveConversation(userId) {
  return redis.get(`${USER_CONVERSATIONS_PREFIX}${userId}:active`);
}
