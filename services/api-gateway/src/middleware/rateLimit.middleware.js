/**
 * Rate Limiting Middleware — powered by Redis
 *
 * Uses a sliding-window counter stored in Redis to enforce a maximum number
 * of requests per time window, keyed by authenticated user ID (or IP address
 * for unauthenticated requests).
 *
 * Redis key format: ratelimit:{identifier}
 * TTL is set to the window duration so keys auto-expire.
 *
 * Defaults (can be overridden via environment variables):
 *   RATE_LIMIT_WINDOW_SECONDS = 60   (1-minute window)
 *   RATE_LIMIT_MAX_REQUESTS   = 100  (100 requests per minute)
 */

import { getRedisClient } from '../config/redis.config.js';

const WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '60', 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const KEY_PREFIX = 'ratelimit:';

/**
 * Returns a unique identifier for the requester:
 *  - authenticated users  → their user ID
 *  - unauthenticated      → their IP address
 */
function getIdentifier(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  return `ip:${ip}`;
}

/**
 * Rate limit middleware factory.
 * @param {object} options
 * @param {number} [options.windowSeconds] - override default window
 * @param {number} [options.maxRequests]   - override default max requests
 */
export function createRateLimitMiddleware(options = {}) {
  const windowSeconds = options.windowSeconds || WINDOW_SECONDS;
  const maxRequests = options.maxRequests || MAX_REQUESTS;

  return async function rateLimitMiddleware(req, res, next) {
    const redis = getRedisClient();

    // If Redis is not available, skip rate limiting gracefully.
    if (!redis || redis.status !== 'ready') {
      return next();
    }

    const identifier = getIdentifier(req);
    const key = `${KEY_PREFIX}${identifier}`;

    try {
      // Atomic increment + set TTL on first request in window
      const current = await redis.incr(key);

      if (current === 1) {
        // First request in this window — set expiry
        await redis.expire(key, windowSeconds);
      }

      // Add rate limit headers so clients know their status
      const ttl = await redis.ttl(key);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
      res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + ttl);

      if (current > maxRequests) {
        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Limit is ${maxRequests} per ${windowSeconds} seconds.`,
            retryAfter: ttl,
          },
        });
      }

      next();
    } catch (err) {
      // Redis error — fail open (don't block the request)
      console.warn('[RateLimit] Redis error, skipping rate limit:', err.message);
      next();
    }
  };
}

/**
 * Stricter rate limiter for sensitive endpoints (auth, login).
 * Default: 10 attempts per minute.
 */
export const authRateLimiter = createRateLimitMiddleware({
  windowSeconds: 60,
  maxRequests: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
});

/**
 * Standard rate limiter for all API routes.
 * Default: 100 requests per minute.
 */
export const apiRateLimiter = createRateLimitMiddleware();

export default createRateLimitMiddleware;
