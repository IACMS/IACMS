/**
 * Redis client for the Auth Service.
 *
 * Used for:
 *  - JWT token blacklist (logout invalidation)
 *  - Login attempt tracking and account lockout
 *
 * Fails open: if Redis is unavailable the service continues to run,
 * with logout and lockout silently degraded.
 */

import Redis from 'ioredis';

let redisClient = null;

export function getRedisClient() {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) {
        console.warn('[Redis][auth] Could not connect after 3 attempts — blacklist and lockout disabled.');
        return null;
      }
      return Math.min(times * 200, 1000);
    },
    lazyConnect: true,
  });

  redisClient.on('connect', () => console.log('[Redis][auth] Connected'));
  redisClient.on('error', (err) => {
    if (err.code !== 'ECONNREFUSED') {
      console.warn('[Redis][auth] Error:', err.message);
    }
  });

  redisClient.connect().catch(() => {});

  return redisClient;
}

export async function closeRedisClient() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export default getRedisClient;
