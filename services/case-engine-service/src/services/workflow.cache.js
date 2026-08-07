/**
 * Redis cache for immutable published workflow definitions (`GET /workflows/:id/full` shape).
 * Falls open when Redis is unavailable.
 */
import Redis from 'ioredis';

const PREFIX = 'workflow:def:';

let _client;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!_client) {
    _client = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    _client.on('error', err => {
      console.warn('[workflow-cache] Redis error:', err.message);
    });
  }
  return _client;
}

export async function getCachedWorkflowFull(workflowId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status !== 'ready') await redis.connect().catch(() => null);
    const raw = await redis.get(PREFIX + workflowId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedWorkflowFull(workflowId, payload) {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status !== 'ready') await redis.connect().catch(() => null);
    await redis.set(PREFIX + workflowId, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export async function invalidateWorkflowFull(workflowId) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(PREFIX + workflowId);
  } catch {
    /* ignore */
  }
}
