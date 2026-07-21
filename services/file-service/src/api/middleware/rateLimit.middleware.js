import { getRedisClient } from '../../config/redis.config.js';
import config from '../../config/index.js';
import { AppError } from '../../../../../shared/common/errors.js';

/**
 * Per-user upload rate limiting via Redis sliding window.
 * Key: fms:ratelimit:upload:{userId}
 */
export function uploadRateLimit(req, res, next) {
  const userId = req.user?.id || req.ip || 'anonymous';
  const limit = config.upload.rateLimitPerMinute;
  const key = `fms:ratelimit:upload:${userId}`;
  const windowSeconds = 60;

  const redis = getRedisClient();

  (async () => {
    try {
      if (redis.status !== 'ready') await redis.connect().catch(() => {});

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));

      if (current > limit) {
        const ttl = await redis.ttl(key);
        res.setHeader('Retry-After', Math.max(1, ttl));
        return next(
          new AppError('Upload rate limit exceeded. Try again later.', 429, 'RATE_LIMIT_EXCEEDED')
        );
      }

      return next();
    } catch {
      // Fail open if Redis is unavailable
      return next();
    }
  })().catch(next);
}
