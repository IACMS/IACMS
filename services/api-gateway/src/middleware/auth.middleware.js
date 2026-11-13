/**
 * Authentication Middleware for API Gateway
 * Supports multi-scheme authentication:
 *   1. Session-based (cookies) — for web browsers
 *   2. JWT (Bearer tokens) — HMAC JWT (internal) & RS256 JWT (OIDC / OAuth2)
 *   3. API Key (X-API-Key header) — for partner agency integrations
 */

import jwt from 'jsonwebtoken';
import * as jose from 'jose';
import { fetchMustChangePasswordFromAuth } from '../utils/authPasswordStatus.js';
import { clearPermissionCache } from './rbac.middleware.js';
import * as apiKeyService from '../services/apiKey.service.js';

if (!process.env.JWT_SECRET) {
  throw new Error('[auth-middleware] JWT_SECRET environment variable is required. Generate with: openssl rand -base64 64');
}
const JWT_SECRET = process.env.JWT_SECRET;

// ── JWKS Cache for RS256 OIDC Token Verification ─────────────────────────────
let localJwks = null;
let lastJwksJson = null;

export function _setLocalJwks(jwks) {
  localJwks = jwks ? (typeof jwks === 'function' ? jwks : jose.createLocalJWKSet(jwks)) : null;
}

function getJwks() {
  if (process.env.OIDC_JWKS_JSON && process.env.OIDC_JWKS_JSON !== lastJwksJson) {
    try {
      lastJwksJson = process.env.OIDC_JWKS_JSON;
      localJwks = jose.createLocalJWKSet(JSON.parse(process.env.OIDC_JWKS_JSON));
    } catch (e) {
      console.warn('[auth-middleware] OIDC_JWKS_JSON parse error:', e.message);
    }
  }
  if (localJwks) return localJwks;
  if (!remoteJwks) {
    const iamUrl = process.env.IAM_SERVICE_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    remoteJwks = jose.createRemoteJWKSet(new URL(`${iamUrl.replace(/\/$/, '')}/oauth/jwks`), {
      cacheMaxAge: 3600000,   // 1 hour cache
      cooldownDuration: 30000, // 30 seconds
    });
  }
  return remoteJwks;
}

/**
 * Public routes that don't require authentication
 * Note: Paths are relative to the /api/v1 mount point
 */
const PUBLIC_ROUTES = [
  // Auth service routes
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/register' },
  { method: 'POST', path: '/auth/refresh' },
  { method: 'POST', path: '/auth/forgot-password' },
  { method: 'POST', path: '/auth/reset-password' },
  { method: 'POST', path: '/auth/verify-email' },
  // Session routes (handled at gateway level)
  { method: 'POST', path: '/session/login' },
  // Tenant validate is public (login screen). Tenant register requires auth + platform permission (RBAC).
  { method: 'GET', path: '/tenants/validate' },
  { method: 'POST', path: '/tenants/self-register' },
];

/**
 * Check if a route is public
 */
function isPublicRoute(method, path) {
  // OIDC & OAuth protocol paths are publicly accessible
  if (
    path.startsWith('/.well-known') ||
    (path.startsWith('/oauth') &&
     !path.startsWith('/oauth/clients') &&
     !path.startsWith('/oauth/providers')) ||
    path.startsWith('/auth/social')
  ) {
    return true;
  }

  return PUBLIC_ROUTES.some((route) => {
    if (route.method !== method) return false;
    return path === route.path || path.startsWith(route.path + '/');
  });
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * Set user context headers for downstream services
 */
function setUserHeaders(req, user) {
  req.headers['x-user-id'] = user.id;
  req.headers['x-tenant-id'] = user.tenantId;
  if (user.departmentId) req.headers['x-department-id'] = user.departmentId;
  if (user.email) req.headers['x-user-email'] = user.email;
  if (user.firstName) req.headers['x-user-firstname'] = user.firstName;
  if (user.lastName) req.headers['x-user-lastname'] = user.lastName;
  if (user.roles) {
    req.headers['x-user-roles'] = Array.isArray(user.roles) ? user.roles.join(',') : user.roles;
  }
  req.headers['x-must-change-password'] = user.mustChangePassword ? 'true' : 'false';
}

/**
 * Validate JWT token (RS256 via JWKS or HMAC via JWT_SECRET)
 */
export async function validateJwtToken(token) {
  let header;
  try {
    header = jose.decodeProtectedHeader(token);
  } catch {
    // If not a valid JWT format, fallback to legacy verify
    try {
      return { valid: true, payload: jwt.verify(token, JWT_SECRET), isOidc: false };
    } catch (err) {
      return { valid: false, error: 'INVALID_TOKEN', message: err.message };
    }
  }

  // 1. OIDC RS256/PS256 JWT Token Verification
  if (header?.alg === 'RS256' || header?.alg === 'PS256') {
    try {
      const issuer = process.env.OIDC_ISSUER || 'http://localhost:3001';
      const jwks = getJwks();
      const { payload } = await jose.jwtVerify(token, jwks, {
        issuer,
      });

      const normalized = {
        id: payload.sub,
        tenantId: payload.tenant_id,
        tenantCode: payload.tenant_code,
        departmentId: payload.department_id ?? null,
        email: payload.email,
        roles: Array.isArray(payload.roles) ? payload.roles : (payload.roles ? [payload.roles] : []),
        scopes: payload.scope ? payload.scope.split(' ') : [],
        apiKeyId: payload.api_key_id ?? null,
        mustChangePassword: false,
      };

      return { valid: true, payload: normalized, isOidc: true };
    } catch (error) {
      if (error.code === 'ERR_JWT_EXPIRED') {
        return { valid: false, error: 'TOKEN_EXPIRED', message: 'Authentication token has expired' };
      }
      return { valid: false, error: 'INVALID_TOKEN', message: error.message };
    }
  }

  // 2. Legacy internal HMAC Token Verification
  try {
    return { valid: true, payload: jwt.verify(token, JWT_SECRET), isOidc: false };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'TOKEN_EXPIRED', message: 'Authentication token has expired' };
    }
    return { valid: false, error: 'INVALID_TOKEN', message: 'Invalid authentication token' };
  }
}

function sessionSavePromise(session) {
  return new Promise((resolve, reject) => {
    if (!session) return resolve();
    session.save((err) => (err ? reject(err) : resolve()));
  });
}

/** Seconds to trust "DB says must_change=false" without re-querying auth (JWT payload may stay stale). */
const RECON_NEGATIVE_CACHE_MS = Number(
  process.env.MUST_CHANGE_NEGATIVE_CACHE_MS || 300_000,
);

const reconcileFalseUntil = new Map();

/** When session/JWT still say `mustChangePassword`, reconcile with auth DB (fixes stale JWT after change). */
async function reconcileMustChangePassword(userId, tenantId, flaggedFromPayload) {
  if (!flaggedFromPayload) return false;

  const key = `${userId}:${tenantId}`;
  const until = reconcileFalseUntil.get(key);
  if (until && Date.now() < until) return false;

  const live = await fetchMustChangePasswordFromAuth(userId, tenantId);

  if (live === false) {
    await clearPermissionCache(userId, tenantId).catch(() => {});
    reconcileFalseUntil.set(key, Date.now() + RECON_NEGATIVE_CACHE_MS);
    return false;
  }

  reconcileFalseUntil.delete(key);
  return true;
}

/**
 * Authentication middleware
 * Checks session first, then falls back to JWT (RS256 / HMAC) or API Key
 */
export async function authenticate(req, res, next) {
  // Skip authentication for public routes
  if (isPublicRoute(req.method, req.path)) {
    return next();
  }

  // Strategy 1: Check for valid session (web browser authentication)
  if (req.session && req.session.user) {
    const sessionUser = req.session.user;

    const prev = Boolean(sessionUser.mustChangePassword);
    const mustChangePassword = await reconcileMustChangePassword(
      sessionUser.id,
      sessionUser.tenantId,
      prev,
    );

    if (mustChangePassword !== prev) {
      sessionUser.mustChangePassword = mustChangePassword;
      try {
        await sessionSavePromise(req.session);
      } catch (e) {
        console.warn('[Gateway] reconcile mustChangePassword session save failed:', e?.message || e);
      }
    }

    req.user = {
      id: sessionUser.id,
      tenantId: sessionUser.tenantId,
      departmentId: sessionUser.departmentId ?? null,
      email: sessionUser.email,
      firstName: sessionUser.firstName,
      lastName: sessionUser.lastName,
      roles: Array.isArray(sessionUser.roles) ? sessionUser.roles : [],
      mustChangePassword,
    };
    req.authMethod = 'session';

    setUserHeaders(req, req.user);
    req.session.lastAccessed = new Date().toISOString();

    return next();
  }

  // Strategy 2: Fall back to JWT token (OIDC RS256 or Legacy HMAC)
  const token = extractBearerToken(req);

  if (token) {
    const result = await validateJwtToken(token);

    if (result.valid) {
      const decoded = result.payload;
      req.authMethod = 'jwt';

      if (result.isOidc) {
        req.user = {
          id: decoded.id,
          tenantId: decoded.tenantId,
          departmentId: decoded.departmentId ?? null,
          email: decoded.email,
          roles: decoded.roles,
          scopes: decoded.scopes,
          mustChangePassword: false,
          isApiKey: Boolean(decoded.apiKeyId),
        };

        if (decoded.apiKeyId) {
          req.authMethod = 'api-key';
          req.apiKeyContext = {
            keyId: decoded.apiKeyId,
            scopes: decoded.scopes,
            tenantId: decoded.tenantId,
          };
          req.headers['x-api-key-id'] = decoded.apiKeyId;
          req.headers['x-api-key-scopes'] = decoded.scopes.join(',');
        }

        setUserHeaders(req, req.user);
        return next();
      }

      // Legacy HMAC JWT token
      const prev = Boolean(decoded.mustChangePassword);
      const mustChangePassword = await reconcileMustChangePassword(
        decoded.id,
        decoded.tenantId,
        prev,
      );

      req.user = {
        id: decoded.id,
        tenantId: decoded.tenantId,
        departmentId: decoded.departmentId ?? null,
        email: decoded.email,
        roles: Array.isArray(decoded.roles) ? decoded.roles : [],
        mustChangePassword,
      };

      setUserHeaders(req, req.user);

      return next();
    }

    return res.status(401).json({
      error: {
        code: result.error,
        message: result.message,
      },
    });
  }

  // Strategy 3: Check for API key (partner agency integration)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && typeof apiKey === 'string' && apiKey.startsWith('iacms_live_')) {
    try {
      const keyData = await apiKeyService.validateApiKey(apiKey, req.ip);

      req.user = {
        id: `apikey:${keyData.keyId}`,
        tenantId: keyData.tenantId,
        departmentId: null,
        email: null,
        roles: [],
        mustChangePassword: false,
        isApiKey: true,
      };

      req.apiKeyContext = {
        keyId: keyData.keyId,
        keyName: keyData.keyName,
        scopes: keyData.scopes,
        tenantId: keyData.tenantId,
        tenantCode: keyData.tenantCode,
      };

      setUserHeaders(req, req.user);
      req.headers['x-api-key-id'] = keyData.keyId;
      req.headers['x-api-key-scopes'] = keyData.scopes.join(',');

      return next();
    } catch (error) {
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY',
          message: error.message || 'Invalid or expired API key',
        },
      });
    }
  }

  return res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a session cookie, Bearer token, or X-API-Key header.',
    },
  });
}

/**
 * Optional authentication middleware
 */
export async function optionalAuth(req, res, next) {
  // Try session first
  if (req.session && req.session.user) {
    req.authMethod = 'session';
    const sessionUser = req.session.user;
    const prev = Boolean(sessionUser.mustChangePassword);
    const mustChangePassword = await reconcileMustChangePassword(
      sessionUser.id,
      sessionUser.tenantId,
      prev,
    );

    if (mustChangePassword !== prev) {
      sessionUser.mustChangePassword = mustChangePassword;
      try {
        await sessionSavePromise(req.session);
      } catch (e) {
        console.warn('[Gateway] optionalAuth session save failed:', e?.message || e);
      }
    }

    req.user = {
      id: sessionUser.id,
      tenantId: sessionUser.tenantId,
      departmentId: sessionUser.departmentId ?? null,
      email: sessionUser.email,
      firstName: sessionUser.firstName,
      lastName: sessionUser.lastName,
      roles: Array.isArray(sessionUser.roles) ? sessionUser.roles : [],
      mustChangePassword,
    };
    setUserHeaders(req, req.user);
    return next();
  }

  const token = extractBearerToken(req);
  if (token) {
    const result = await validateJwtToken(token);
    if (result.valid) {
      req.authMethod = 'jwt';
      const decoded = result.payload;
      if (result.isOidc) {
        req.user = {
          id: decoded.id,
          tenantId: decoded.tenantId,
          departmentId: decoded.departmentId ?? null,
          email: decoded.email,
          roles: decoded.roles,
          mustChangePassword: false,
        };
      } else {
        const prev = Boolean(decoded.mustChangePassword);
        const mustChangePassword = await reconcileMustChangePassword(
          decoded.id,
          decoded.tenantId,
          prev,
        );
        req.user = {
          id: decoded.id,
          tenantId: decoded.tenantId,
          departmentId: decoded.departmentId ?? null,
          email: decoded.email,
          roles: Array.isArray(decoded.roles) ? decoded.roles : [],
          mustChangePassword,
        };
      }
      setUserHeaders(req, req.user);
    }
  }

  next();
}

/**
 * Require specific authentication method
 * Use when you need to enforce session-only or JWT-only auth
 */
export function requireAuthMethod(method) {
  return (req, res, next) => {
    if (req.authMethod !== method) {
      return res.status(401).json({
        error: {
          code: 'INVALID_AUTH_METHOD',
          message: `This endpoint requires ${method} authentication`,
        },
      });
    }
    next();
  };
}

export default authenticate;
