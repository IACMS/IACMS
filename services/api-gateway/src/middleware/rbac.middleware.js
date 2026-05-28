/**
 * RBAC Middleware for API Gateway
 *
 * For every authenticated request, loads permissions + role IDs from RBAC (Redis cache).
 * Downstream proxies read `req.rbacEnvelope` to forward `x-user-roles`.
 */

import { getRedisClient } from '../config/redis.config.js';

const CACHE_TTL_SECONDS = 5 * 60;
const CACHE_KEY_PREFIX = 'rbac:perms:';

const ROUTE_PERMISSIONS = {
  'GET:/api/v1/cases': 'cases:read',
  'POST:/api/v1/cases': 'cases:create',
  'GET:/api/v1/cases/:id': 'cases:read',
  'PUT:/api/v1/cases/:id': 'cases:update',
  'PATCH:/api/v1/cases/:id': 'cases:update',
  'DELETE:/api/v1/cases/:id': 'cases:delete',
  'POST:/api/v1/cases/:id/assign': 'cases:assign',
  'POST:/api/v1/cases/:id/close': 'cases:close',
  'GET:/api/v1/cases/:id/assignments': 'cases:read',
  'POST:/api/v1/cases/:id/assignments': 'cases:assign',
  'GET:/api/v1/cases/:id/state': 'cases:read',
  'POST:/api/v1/cases/:id/transitions/:transitionId/execute': 'cases:update',
  'GET:/api/v1/cases/:id/history': 'cases:read',

  'GET:/api/v1/workflows': 'workflows:read',
  'POST:/api/v1/workflows': 'workflows:create',
  'GET:/api/v1/workflows/published': 'workflows:read',
  'GET:/api/v1/workflows/:id': 'workflows:read',
  'GET:/api/v1/workflows/:id/full': 'workflows:read',
  'PUT:/api/v1/workflows/:id': 'workflows:update',
  'DELETE:/api/v1/workflows/:id': 'workflows:delete',
  'POST:/api/v1/workflows/:id/steps': 'workflows:update',
  'PUT:/api/v1/workflows/:id/steps/:stepId': 'workflows:update',
  'DELETE:/api/v1/workflows/:id/steps/:stepId': 'workflows:update',
  'POST:/api/v1/workflows/:id/transitions': 'workflows:update',
  'DELETE:/api/v1/workflows/:id/transitions/:transitionId': 'workflows:update',
  'POST:/api/v1/workflows/:id/publish': 'workflows:update',
  'POST:/api/v1/workflows/:id/new-version': 'workflows:update',
  'POST:/api/v1/workflows/:id/archive': 'workflows:update',

  'GET:/api/v1/referrals': 'cases:read',
  'GET:/api/v1/referrals/:id': 'cases:read',
  'POST:/api/v1/referrals': 'cases:update',
  'POST:/api/v1/referrals/:id/accept': 'cases:update',
  'POST:/api/v1/referrals/:id/reject': 'cases:update',
  'POST:/api/v1/referrals/:id/complete': 'cases:update',

  'GET:/api/v1/rbac/users': 'users:read',
  'GET:/api/v1/rbac/users/:id': 'users:read',
  'GET:/api/v1/rbac/roles': 'roles:read',
  'POST:/api/v1/rbac/roles': 'roles:create',
  'PUT:/api/v1/rbac/roles/:id': 'roles:update',
  'DELETE:/api/v1/rbac/roles/:id': 'roles:delete',
  'POST:/api/v1/rbac/user-roles/assign': 'roles:assign',

  'GET:/api/v1/audit': 'audit:read',
  'GET:/api/v1/audit/:id': 'audit:read',
  'GET:/api/v1/audit/cases/:caseId': 'audit:read',
  'GET:/api/v1/audit/users/:userId/actions': 'audit:read',
  'GET:/api/v1/audit/compliance/:tenantId': 'audit:read',

  'GET:/api/v1/tenants': 'tenants:read',
  'PUT:/api/v1/tenants/:id': 'tenants:update',
};

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
    const colon = routeKey.indexOf(':');
    const routeMethod = routeKey.slice(0, colon);
    const routePath = routeKey.slice(colon + 1);
    if (routeMethod === method && matchPath(routePath, path)) return permission;
  }
  return null;
}

function normalizeRbacEnvelope(cached) {
  if (!cached) return { permissions: [], roleIds: [] };
  if (Array.isArray(cached)) return { permissions: cached, roleIds: [] };
  return {
    permissions: cached.permissions || [],
    roleIds: cached.roleIds || [],
  };
}

async function fetchUserRbacEnvelope(userId, tenantId, rbacServiceUrl) {
  try {
    const response = await fetch(`${rbacServiceUrl}/permissions/user/${userId}`, {
      headers: { 'x-user-id': userId, 'x-tenant-id': tenantId },
    });
    if (!response.ok) {
      console.error('[RBAC] Failed to fetch permissions:', response.status);
      return { permissions: [], roleIds: [] };
    }
    const data = await response.json();
    const permissions = data.permissions || [];
    const roleIds =
      data.roleIds?.length ?
        data.roleIds :
        Array.from(new Set((data.roles || []).map(r => r.id).filter(Boolean)));
    return { permissions, roleIds };
  } catch (error) {
    console.error('[RBAC] Error fetching permissions:', error.message);
    return { permissions: [], roleIds: [] };
  }
}

async function getUserRbacEnvelope(userId, tenantId, rbacServiceUrl) {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${tenantId}`;
  const redis = getRedisClient();

  if (redis && redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return normalizeRbacEnvelope(JSON.parse(cached));
    } catch (err) {
      console.warn('[RBAC] Redis read error, falling back to live fetch:', err.message);
    }
  }

  const envelope = await fetchUserRbacEnvelope(userId, tenantId, rbacServiceUrl);

  if (redis && redis.status === 'ready') {
    try {
      await redis.set(cacheKey, JSON.stringify(envelope), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      console.warn('[RBAC] Redis write error:', err.message);
    }
  }

  return envelope;
}

function hasPermission(userPermissions, requiredPermission) {
  if (userPermissions.includes('*') || userPermissions.includes('admin:*')) return true;
  if (userPermissions.includes(requiredPermission)) return true;
  const [resource] = requiredPermission.split(':');
  if (userPermissions.includes(`${resource}:*`)) return true;
  return false;
}

export function createRbacMiddleware(rbacServiceUrl) {
  return async function rbacMiddleware(req, res, next) {
    if (!req.user) return next();

    try {
      const envelope = await getUserRbacEnvelope(req.user.id, req.user.tenantId, rbacServiceUrl);
      req.rbacEnvelope = envelope;

      const requiredPermission = getRequiredPermission(req.method, req.path);
      if (!requiredPermission) return next();

      if (!hasPermission(envelope.permissions, requiredPermission)) {
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
      next();
    }
  };
}

export async function clearPermissionCache(userId, tenantId) {
  const redis = getRedisClient();
  if (redis && redis.status === 'ready') {
    await redis.del(`${CACHE_KEY_PREFIX}${userId}:${tenantId}`);
  }
}

export async function clearAllPermissionCache() {
  const redis = getRedisClient();
  if (redis && redis.status === 'ready') {
    const keys = await redis.keys(`${CACHE_KEY_PREFIX}*`);
    if (keys.length) await redis.del(...keys);
  }
}

export default createRbacMiddleware;
