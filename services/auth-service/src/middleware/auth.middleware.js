import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from '../../../../shared/common/errors.js';
import { getRedisClient } from '../config/redis.config.js';
import prisma from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';

/** When false, only JWT Bearer is accepted (stricter — use if auth-service is reachable without the gateway). */
function trustGatewayForwardedHeaders() {
  const v = process.env.TRUST_GATEWAY_IDENTITY_HEADERS;
  return v !== 'false' && v !== '0';
}

/**
 * Browser clients authenticate at the gateway with a session cookie. The gateway sets
 * x-user-id / x-tenant-id on proxied requests but does not always attach Authorization.
 * Load the user from the DB and verify the declared tenant matches the record.
 */
async function attachUserFromGatewayForwardedIdentity(req, res, next) {
  const headerUserId = req.headers['x-user-id'];
  const headerTenantId = req.headers['x-tenant-id'];
  if (!headerUserId || !headerTenantId) return false;

  const u = await prisma.user.findFirst({
    where: { id: String(headerUserId), isActive: true },
    select: {
      id: true,
      tenantId: true,
      email: true,
      mustChangePassword: true,
      userRoles: { select: { roleId: true } },
    },
  });

  if (!u || u.tenantId !== String(headerTenantId)) {
    next(new UnauthorizedError('Invalid forwarded identity'));
    return true;
  }

  req.user = {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    mustChangePassword: u.mustChangePassword ?? false,
    roles: u.userRoles.map((r) => r.roleId),
  };
  next();
  return true;
}

/**
 * Authenticate JWT Bearer, or — when forwarded by the API gateway — `x-user-id` + `x-tenant-id`.
 * JWT path also checks the Redis blacklist for logout/revocation.
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    if (!trustGatewayForwardedHeaders()) {
      return next(new UnauthorizedError('Token required'));
    }
    try {
      const ok = await attachUserFromGatewayForwardedIdentity(req, res, next);
      if (ok) return;
    } catch (err) {
      return next(err);
    }
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

    /**
     * Gateway reconciles mustChangePassword with the DB; JWT may stay stale until refresh.
     * Downstream middleware (requirePasswordChange) must see the DB value, same as forwarded identity.
     */
    const pwdRow = await prisma.user.findFirst({
      where: { id: String(decoded.id), isActive: true },
      select: { mustChangePassword: true },
    });
    if (!pwdRow) {
      return next(new UnauthorizedError('Invalid or expired token'));
    }

    req.user = { ...decoded, mustChangePassword: pwdRow.mustChangePassword ?? false };
    next();
  } catch (error) {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

/**
 * If `Authorization: Bearer` is present, verify and attach `req.user` (JWT payload).
 * If absent, continues (gateway may forward `x-user-id` / `x-user-roles` instead).
 */
export async function authenticateTokenOptional(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

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
        /* no-op */
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

