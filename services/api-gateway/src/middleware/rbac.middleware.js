/**
 * RBAC Middleware for API Gateway
 *
 * Checks user permissions before allowing access to protected resources.
 * Permission results are cached in Redis (5-minute TTL) to avoid calling
 * the RBAC service on every single request.
 *
 * Cache key format: rbac:perms:{userId}:{tenantId}
 */

import { getRedisClient } from '../config/redis.config.js';

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_KEY_PREFIX = 'rbac:perms:';

/**
 * Route → required permission mapping.
 * HTTP method + path pattern → permission string.
 */
const ROUTE_PERMISSIONS = {
  // Cases
  'GET:/api/v1/cases': 'cases:read',
  'POST:/api/v1/cases': 'cases:create',
  'GET:/api/v1/cases/:id': 'cases:read',
  'PUT:/api/v1/cases/:id': 'cases:update',
  'PATCH:/api/v1/cases/:id': 'cases:update',
  'DELETE:/api/v1/cases/:id': 'cases:delete',
  'POST:/api/v1/cases/:id/assign': 'cases:assign',
  'POST:/api/v1/cases/:id/close': 'cases:close',

  // Assignments
  'GET:/api/v1/cases/:id/assignments': 'cases:read',
  'POST:/api/v1/cases/:id/assignments': 'cases:assign',

  // Workflows
  'GET:/api/v1/workflows': 'workflows:read',
  'POST:/api/v1/workflows': 'workflows:create',
  'GET:/api/v1/workflows/:id': 'workflows:read',
  'PUT:/api/v1/workflows/:id': 'workflows:update',
  'DELETE:/api/v1/workflows/:id': 'workflows:delete',

  // Users (via RBAC service)
  'GET:/api/v1/rbac/users': 'users:read',
  'GET:/api/v1/rbac/users/:id': 'users:read',

  // Roles
  'GET:/api/v1/rbac/roles': 'roles:read',
  'POST:/api/v1/rbac/roles': 'roles:create',
  'PUT:/api/v1/rbac/roles/:id': 'roles:update',
  'DELETE:/api/v1/rbac/roles/:id': 'roles:delete',
  'POST:/api/v1/rbac/user-roles/assign': 'roles:assign',

  // Audit
  'GET:/api/v1/audit': 'audit:read',
  'GET:/api/v1/audit/:id': 'audit:read',

  // Tenants
  'GET:/api/v1/tenants': 'tenants:read',
  'PUT:/api/v1/tenants/:id': 'tenants:update',
};

// ─── Path matching ───────────────────────────────────────────────────────────

function matchPath(pattern, actualPath) {
  const patternParts = pattern.split('/');
  const actualParts = actualPath.split('/');
  if (patternParts.length !== actualParts.length) return false;
  return patternParts.every((part, i) => part.startsWith(':') || part === actualParts[i]);
}

function getRequiredPermission(method, path) {
  const exactKey = `${method}:${path}`;
  if (ROUTE_PERMISSIONS[exactKey]) return ROUTE_PERMISSIONS[exactKey];

  for (const [routeKey, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    const [routeMethod, routePath] = routeKey.split(':');
    if (routeMethod === method && matchPath(routePath, path)) return permission;
  }
  return null;
}

// ─── Permission fetching ──────────────────────────────────────────────────────

async function fetchUserPermissions(userId, tenantId, rbacServiceUrl) {
  try {
    const response = await fetch(`${rbacServiceUrl}/permissions/user/${userId}`, {
      headers: { 'x-user-id': userId, 'x-tenant-id': tenantId },
    });
    if (!response.ok) {
      console.error('[RBAC] Failed to fetch permissions:', response.status);
      return [];
    }
    const data = await response.json();
    return data.permissions || [];
  } catch (error) {
    console.error('[RBAC] Error fetching permissions:', error.message);
    return [];
  }
}

// ─── Redis-backed cache ───────────────────────────────────────────────────────

async function getUserPermissions(userId, tenantId, rbacServiceUrl) {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${tenantId}`;
  const redis = getRedisClient();

  // Try Redis first
  if (redis && redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('[RBAC] Redis read error, falling back to live fetch:', err.message);
    }
  }

  // Cache miss (or Redis unavailable) — fetch from RBAC service
  const permissions = await fetchUserPermissions(userId, tenantId, rbacServiceUrl);

  // Store in Redis if available
  if (redis && redis.status === 'ready') {
    try {
      await redis.set(cacheKey, JSON.stringify(permissions), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      console.warn('[RBAC] Redis write error:', err.message);
    }
  }

  return permissions;
}

// ─── Permission check ─────────────────────────────────────────────────────────

function hasPermission(userPermissions, requiredPermission) {
  if (userPermissions.includes('*') || userPermissions.includes('admin:*')) return true;
  if (userPermissions.includes(requiredPermission)) return true;
  const [resource] = requiredPermission.split(':');
  if (userPermissions.includes(`${resource}:*`)) return true;
  return false;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function createRbacMiddleware(rbacServiceUrl) {
  return async function rbacMiddleware(req, res, next) {
    if (!req.user) return next();

    const requiredPermission = getRequiredPermission(req.method, req.path);
    if (!requiredPermission) return next();

    try {
      const userPermissions = await getUserPermissions(req.user.id, req.user.tenantId, rbacServiceUrl);

      if (!hasPermission(userPermissions, requiredPermission)) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: `You don't have permission to perform this action. Required: ${requiredPermission}`,
          },
        });
      }

      next();
    } catch (error) {
      console.error('[RBAC] Middleware error:', error);
      next(); // fail open
    }
  };
}

// ─── Cache invalidation helpers ───────────────────────────────────────────────

/**
 * Invalidate cached permissions for a specific user.
 * Call this whenever a user's roles change.
 */
export async function clearPermissionCache(userId, tenantId) {
  const redis = getRedisClient();
  if (redis && redis.status === 'ready') {
    await redis.del(`${CACHE_KEY_PREFIX}${userId}:${tenantId}`);
  }
}

/**
 * Invalidate all cached permissions (e.g., after a bulk role change).
 */
export async function clearAllPermissionCache() {
  const redis = getRedisClient();
  if (redis && redis.status === 'ready') {
    const keys = await redis.keys(`${CACHE_KEY_PREFIX}*`);
    if (keys.length) await redis.del(...keys);
  }
}

export default createRbacMiddleware;
