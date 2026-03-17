import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from '../../../../shared/common/errors.js';
import { getRedisClient } from '../config/redis.config.js';

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';

/**
 * Authenticate JWT token.
 * Also checks the Redis blacklist so that logged-out tokens are rejected immediately.
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return next(new UnauthorizedError('Token required'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check blacklist (non-fatal if Redis is down — fail open)
    if (decoded.jti) {
      try {
        const redis = getRedisClient();
        if (redis) {
          const isBlacklisted = await redis.get(`auth:blacklist:${decoded.jti}`);
          if (isBlacklisted) {
            return next(new UnauthorizedError('Token has been revoked. Please log in again.'));
          }
        }
      } catch {
        // Redis unavailable — allow request through (fail open)
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

/**
 * Block access for users who must change their password first.
 * Apply after authenticateToken on all protected routes except POST /change-password.
 */
export function requirePasswordChange(req, res, next) {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      error: 'PASSWORD_CHANGE_REQUIRED',
      message: 'You must change your password before continuing.',
    });
  }
  next();
}

