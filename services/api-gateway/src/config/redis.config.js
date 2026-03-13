/**
 * Redis client for the API Gateway.
 *
 * Used for:
 *  - RBAC permission caching (avoids hitting RBAC service on every request)
 *  - Rate limiting (per-user / per-IP request counters)
 *
 * NOT used for:
 *  - Sessions  → stored in PostgreSQL (user_sessions table)
 *  - Events    → handled by Kafka
 */

import Redis from 'ioredis';

let redisClient = null;

/**
 * Returns (and lazily creates) the shared Redis client.
 * Falls back to null if Redis is unavailable so the rest of the app keeps running.
 */
export function getRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = new Redis(url, {
    // Retry strategy: stop retrying after 3 attempts so a missing Redis
    // doesn't hang the gateway on startup.
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) {
        console.warn('[Redis] Could not connect after 3 attempts — caching and rate-limiting disabled.');
        return null; // stop retrying
      }
      return Math.min(times * 200, 1000); // wait 200ms, 400ms, 600ms…
    },
    lazyConnect: true,
  });

  redisClient.on('connect', () => console.log('[Redis] Connected'));
  redisClient.on('error', (err) => {
    // Log but never crash — Redis is an enhancement, not a hard dependency.
    if (err.code !== 'ECONNREFUSED') {
      console.warn('[Redis] Error:', err.message);
    }
  });

  redisClient.connect().catch(() => {
    // connect() rejection is already handled by the 'error' listener above.
  });

  return redisClient;
}

/**
 * Gracefully close the Redis connection on process exit.
 */
export async function closeRedisClient() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export default getRedisClient;
