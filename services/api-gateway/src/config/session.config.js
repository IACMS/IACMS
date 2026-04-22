/**
 * Session configuration for the API Gateway.
 * Stores express-session data in Redis (not PostgreSQL).
 */

import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';

/** Redis key prefix for session keys (connect-redis appends the session id). */
export const SESSION_REDIS_KEY_PREFIX = 'iacms:sess:';

let sessionRedisClient = null;

/**
 * Returns the node-redis client used for the session store (for tests / shutdown).
 * Lazily created by {@link createSessionMiddleware}.
 */
export function getSessionRedisClient() {
  return sessionRedisClient;
}

/**
 * Create express-session middleware backed by Redis.
 * Fails fast if Redis is unreachable (session-based auth requires Redis).
 */
export async function createSessionMiddleware() {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  if (!sessionRedisClient) {
    sessionRedisClient = createClient({ url });
    sessionRedisClient.on('error', (err) => {
      console.error('[Session][Redis] Client error:', err.message);
    });
    const connectTimeoutMs = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '5000', 10);
    try {
      await Promise.race([
        sessionRedisClient.connect(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Redis connect timeout after ${connectTimeoutMs}ms`)),
            connectTimeoutMs
          )
        ),
      ]);
    } catch (err) {
      sessionRedisClient = null;
      throw new Error(
        `Session store: cannot connect to Redis at ${url}. ` +
          'Set REDIS_URL or start Redis. Session-based auth is unavailable without Redis.',
        { cause: err }
      );
    }
  }

  const maxAgeSec = parseInt(process.env.SESSION_MAX_AGE || '86400', 10);
  const redisStore = new RedisStore({
    client: sessionRedisClient,
    prefix: SESSION_REDIS_KEY_PREFIX,
    ttl: maxAgeSec,
  });

  const sessionConfig = {
    store: redisStore,
    secret: process.env.SESSION_SECRET || 'iacms-session-secret-change-in-production',
    name: 'iacms.sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: maxAgeSec * 1000,
      sameSite: 'lax',
      path: '/',
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    sessionConfig.cookie.secure = false;
  }

  console.log('Session store: Redis connected');
  return session(sessionConfig);
}

/**
 * Close the session store Redis client (ioredis cache client is separate).
 */
export async function closeSessionStore() {
  if (sessionRedisClient) {
    try {
      await sessionRedisClient.quit();
    } catch (err) {
      console.warn('Session store: Redis quit error:', err?.message);
    }
    sessionRedisClient = null;
  }
  console.log('Session store: Redis connection closed');
}

export default createSessionMiddleware;
