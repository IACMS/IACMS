import jwt from 'jsonwebtoken';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { UnauthorizedError, ForbiddenError } from '#iam/iamErrors.js';
import { getRedisClient } from '../config/redis.config.js';
import prisma from '../config/database.js';
import { resolveGatewayIdentity } from '#iam/iamGatewayIdentity.js';
import { loadJwks } from '../oauth/jwks.js';

if (!process.env.JWT_SECRET) {
  throw new Error('[iam-auth-middleware] JWT_SECRET environment variable is required. Generate with: openssl rand -base64 64');
}
const JWT_SECRET = process.env.JWT_SECRET;
function getJwtSecret() {
  return process.env.JWT_SECRET || JWT_SECRET;
}

let cachedJwksJson = null;
let localJwks = null;
function getLocalJwks() {
  const current = process.env.OIDC_JWKS_JSON;
  if (!localJwks || cachedJwksJson !== current) {
    cachedJwksJson = current;
    try {
      localJwks = createLocalJWKSet(loadJwks());
    } catch {
      localJwks = null;
    }
  }
  return localJwks;
}

/** When false, only JWT Bearer is accepted (stricter — use if auth-service is reachable without the gateway). */
function trustGatewayForwardedHeaders() {
  const v = process.env.TRUST_GATEWAY_IDENTITY_HEADERS;
  return v !== 'false' && v !== '0';
}

/**
 * Browser clients authenticate at the gateway with a session cookie. The gateway sets
 * x-user-id / x-tenant-id on proxied requests but does not always attach Authorization.
 */
async function attachUserFromGatewayForwardedIdentity(req, res, next) {
  const user = await resolveGatewayIdentity(prisma, req);
  if (!user) {
    next(new UnauthorizedError('Invalid forwarded identity'));
    return true;
  }

  req.user = user;
  next();
  return true;
}

/**
 * Authenticate JWT Bearer (HS256 session token OR RS256 OIDC token),
 * or — when forwarded by the API gateway — `x-user-id` + `x-tenant-id`.
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

  let decoded = null;
  let isOidc = false;

  try {
    decoded = jwt.verify(token, getJwtSecret());
    if (decoded.type === 'refresh' || (decoded.type && decoded.type !== 'access')) {
      return next(new UnauthorizedError('Invalid token type'));
    }
  } catch (hmacErr) {
    // If HMAC verification fails, check if this is an RS256 OIDC Access Token
    try {
      const jwks = getLocalJwks();
      if (jwks) {
        const issuer = process.env.OIDC_ISSUER || 'http://localhost:3001';
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          algorithms: ['RS256'],
        });
        if (payload && payload.sub) {
          decoded = {
            id: payload.sub,
            tenantId: payload.tenant_id || payload.organization_id || null,
            roles: Array.isArray(payload.roles) ? payload.roles : [],
            scope: payload.scope || '',
            iam_admin: payload.iam_admin === true,
            email: payload.email || null,
          };
          isOidc = true;
        }
      }
    } catch (oidcErr) {
      return next(new UnauthorizedError('Invalid or expired token'));
    }
  }

  if (!decoded) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }

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
    select: {
      id: true,
      tenantId: true,
      mustChangePassword: true,
      userRoles: {
        select: { role: { select: { name: true, slug: true } } },
      },
    },
  });
  if (!pwdRow) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }

  const roleSlugs = (pwdRow.userRoles || []).map((ur) => ur.role?.slug || ur.role?.name).filter(Boolean);
  const allRoles = [...new Set([...(decoded.roles || []), ...roleSlugs])];
  const isPlatformAdmin =
    decoded.iam_admin === true ||
    allRoles.some((r) => ['system_admin', 'system-admin', 'iam-admin'].includes(r));
  const isOrgAdmin = allRoles.some((r) => ['tenant_admin', 'tenant-admin'].includes(r));

  if (isPlatformAdmin) {
    req.iamAdminScope = { type: 'platform', organizationId: null, tenantId: decoded.tenantId || pwdRow.tenantId };
  } else if (isOrgAdmin) {
    req.iamAdminScope = { type: 'organization', organizationId: null, tenantId: decoded.tenantId || pwdRow.tenantId };
  }

  req.user = {
    ...decoded,
    tenantId: decoded.tenantId || pwdRow.tenantId,
    roles: allRoles,
    mustChangePassword: pwdRow.mustChangePassword ?? false,
  };
  next();
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

  let decoded = null;
  try {
    decoded = jwt.verify(token, getJwtSecret());
    if (decoded.type === 'refresh' || (decoded.type && decoded.type !== 'access')) {
      return next(new UnauthorizedError('Invalid token type'));
    }
  } catch (hmacErr) {
    try {
      const jwks = getLocalJwks();
      if (jwks) {
        const issuer = process.env.OIDC_ISSUER || 'http://localhost:3001';
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          algorithms: ['RS256'],
        });
        if (payload && payload.sub) {
          decoded = {
            id: payload.sub,
            tenantId: payload.tenant_id || payload.organization_id || null,
            roles: Array.isArray(payload.roles) ? payload.roles : [],
            scope: payload.scope || '',
            iam_admin: payload.iam_admin === true,
            email: payload.email || null,
          };
        }
      }
    } catch {
      return next(new UnauthorizedError('Invalid or expired token'));
    }
  }

  if (!decoded) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }

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

