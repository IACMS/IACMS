/**
 * Authentication Middleware for API Gateway
 * Supports dual authentication: Session-based (cookies) and JWT (tokens)
 * 
 * Priority:
 * 1. Session authentication (for web browsers)
 * 2. JWT authentication (for API clients)
 */

import jwt from 'jsonwebtoken';
import { fetchMustChangePasswordFromAuth } from '../utils/authPasswordStatus.js';
import { clearPermissionCache } from './rbac.middleware.js';

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';

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
];

/**
 * Check if a route is public
 */
function isPublicRoute(method, path) {
  return PUBLIC_ROUTES.some(route => {
    if (route.method !== method) return false;
    // Exact match or prefix match (for paths like /tenants/validate/:code)
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
  req.headers['x-user-email'] = user.email;
  if (user.firstName) req.headers['x-user-firstname'] = user.firstName;
  if (user.lastName) req.headers['x-user-lastname'] = user.lastName;
  if (user.roles) {
    req.headers['x-user-roles'] = Array.isArray(user.roles) ? user.roles.join(',') : user.roles;
  }
}

/**
 * Validate JWT token and return decoded payload
 */
function validateJwtToken(token) {
  try {
    return { valid: true, payload: jwt.verify(token, JWT_SECRET) };
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
 * Checks session first, then falls back to JWT
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

    setUserHeaders(req, req.user);
    req.session.lastAccessed = new Date().toISOString();

    return next();
  }

  // Strategy 2: Fall back to JWT token (API client authentication)
  const token = extractBearerToken(req);

  if (token) {
    const result = validateJwtToken(token);

    if (result.valid) {
      const decoded = result.payload;
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

  return res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a valid session cookie or Bearer token.',
    },
  });
}

/**
 * Optional authentication middleware
 */
export async function optionalAuth(req, res, next) {
  // Try session first
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
        console.warn('[Gateway] optionalAuth session save failed:', e?.message || e);
      }
    }

    req.user = {
      id: sessionUser.id,
      tenantId: sessionUser.tenantId,
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
    const result = validateJwtToken(token);
    if (result.valid) {
      const decoded = result.payload;
      const prev = Boolean(decoded.mustChangePassword);
      const mustChangePassword = await reconcileMustChangePassword(
        decoded.id,
        decoded.tenantId,
        prev,
      );
      req.user = {
        id: decoded.id,
        tenantId: decoded.tenantId,
        email: decoded.email,
        roles: Array.isArray(decoded.roles) ? decoded.roles : [],
        mustChangePassword,
      };
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
