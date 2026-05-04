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
// Paths match Express req.path when middleware is mounted at /api/v1 (no /api/v1 prefix).
const ROUTE_PERMISSIONS = {
  // Cases
  'GET:/cases': 'cases:read',
  'POST:/cases': 'cases:create',
  'GET:/cases/:id': 'cases:read',
  'PUT:/cases/:id': 'cases:update',
  'PATCH:/cases/:id': 'cases:update',
  'DELETE:/cases/:id': 'cases:delete',
  'GET:/cases/:id/state': 'cases:read',
  'GET:/cases/:id/history': 'cases:read',
  'POST:/cases/:id/transitions/:transitionId/execute': 'cases:update',

  // Assignments (case-service mounts /assignments)
  'GET:/assignments': 'cases:read',
  'POST:/assignments': 'cases:assign',
  'POST:/assignments/:id/unassign': 'cases:assign',

  // Attachments
  'GET:/attachments/case/:caseId': 'cases:read',
  'POST:/attachments': 'cases:update',
  'DELETE:/attachments/:id': 'cases:update',

  // Workflows
  'GET:/workflows': 'workflows:read',
  'POST:/workflows': 'workflows:create',
  'GET:/workflows/published': 'workflows:read',
  'GET:/workflows/:id': 'workflows:read',
  'GET:/workflows/:id/full': 'workflows:read',
  'PUT:/workflows/:id': 'workflows:update',
  'DELETE:/workflows/:id': 'workflows:delete',
  'POST:/workflows/:id/new-version': 'workflows:update',
  'POST:/workflows/:id/steps': 'workflows:update',
  'PUT:/workflows/:id/steps/:stepId': 'workflows:update',
  'DELETE:/workflows/:id/steps/:stepId': 'workflows:update',
  'POST:/workflows/:id/transitions': 'workflows:update',
  'PUT:/workflows/:id/transitions/:transitionId': 'workflows:update',
  'DELETE:/workflows/:id/transitions/:transitionId': 'workflows:update',
  'POST:/workflows/:id/publish': 'workflows:update',

  // Users (via RBAC service)
  'GET:/rbac/users': 'users:read',
  'GET:/rbac/users/:id': 'users:read',

  // Roles
  'GET:/rbac/roles': 'roles:read',
  'POST:/rbac/roles': 'roles:create',
  'PUT:/rbac/roles/:id': 'roles:update',
  'DELETE:/rbac/roles/:id': 'roles:delete',
  'POST:/rbac/user-roles/assign': 'roles:assign',
  'POST:/rbac/user-roles/revoke': 'roles:assign',

  // Audit
  'GET:/audit': 'audit:read',
  'GET:/audit/:id': 'audit:read',

  // Tenants
  'GET:/tenants': 'tenants:read',
  'PUT:/tenants/:id': 'tenants:update',
  'PATCH:/tenants/:id/config': 'tenants:update',
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
    const sep = routeKey.indexOf(':');
    if (sep === -1) continue;
    const routeMethod = routeKey.slice(0, sep);
    const routePath = routeKey.slice(sep + 1);
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
