/**
 * RBAC Middleware for API Gateway
 *
 * For every authenticated request, loads permissions + role IDs from RBAC (Redis cache).
 * Downstream proxies read `req.rbacEnvelope` to forward `x-user-roles`.
 */

import { getRedisClient } from '../config/redis.config.js';

const CACHE_TTL_SECONDS = 5 * 60;
const CACHE_KEY_PREFIX = 'rbac:perms:';

/**
 * Route → required permission mapping.
 * HTTP method + path pattern → permission string, or **array of strings** (user needs one of them).
 */
// Paths match Express req.path when middleware is mounted at /api/v1 (no /api/v1 prefix).
const ROUTE_PERMISSIONS = {
  // Platform — operational visibility (connectivity from gateway → microservices)
  'GET:/platform/service-probes': 'platform:manage_tenants',

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

  // Dashboard (case-service)
  'GET:/dashboard/tasks': 'cases:read',
  'GET:/dashboard/reports': 'cases:read',

  // Agency chat (auth-service)
  'GET:/chat/colleagues': 'cases:read',
  'GET:/chat/messages': 'cases:read',
  'POST:/chat/messages': 'cases:read',

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

  // User admin (auth-service, proxied as /api/v1/auth → /auth)
  'POST:/auth/users/create': 'users:create',
  'GET:/auth/users': 'users:read',
  'GET:/auth/users/:id': 'users:read',
  'PATCH:/auth/users/:id': 'users:update',
  'PATCH:/auth/users/:id/role': 'roles:assign',
  'PATCH:/auth/users/:id/deactivate': 'users:update',
  'PATCH:/auth/users/:id/reactivate': 'users:update',
  'DELETE:/auth/users/:id': 'users:delete',

  // Roles (RBAC service) — listing roles is required for workflow/case UIs to show friendly role names.
  // Allow anyone who can read workflows or users (or formally manage roles) to avoid spurious 403 + global banner.
  'GET:/rbac/roles': ['users:read', 'workflows:read', 'roles:read'],
  'POST:/rbac/roles': 'roles:create',
  'PUT:/rbac/roles/:id': 'roles:update',
  'DELETE:/rbac/roles/:id': 'roles:delete',
  'POST:/rbac/user-roles/assign': 'roles:assign',
  'POST:/rbac/user-roles/revoke': 'roles:assign',

  // Audit
  'GET:/audit': 'audit:read',
  'GET:/audit/:id': 'audit:read',

  // Tenants — register orgs is platform-admin only (`platform:manage_tenants`)
  'POST:/tenants/register': 'platform:manage_tenants',
  'GET:/tenants': 'tenants:read',
  'PUT:/tenants/:id': 'tenants:update',
  'PATCH:/tenants/:id/config': 'tenants:update',
  'POST:/tenants/:id/logo': 'tenants:update',

  // Referrals (cross-agency — explicit permissions)
  'GET:/referrals': 'referrals:read',
  'GET:/referrals/:id': 'referrals:read',
  'POST:/referrals': 'referrals:create',
  'POST:/referrals/:id/accept': 'referrals:update',
  'POST:/referrals/:id/assign': 'referrals:update',
  'POST:/referrals/:id/reject': 'referrals:update',
  
  // Additional case operations
'POST:/cases/:id/assign': 'cases:assign',
'POST:/cases/:id/close': 'cases:close',
'GET:/cases/:id/assignments': 'cases:read',
'POST:/cases/:id/assignments': 'cases:assign',

// Workflow archive
'POST:/workflows/:id/archive': 'workflows:update',

// Referral completion
'POST:/referrals/:id/complete': 'referrals:update',

// Extra audit routes
'GET:/audit/cases/:caseId': 'audit:read',
'GET:/audit/users/:userId/actions': 'audit:read',
'GET:/audit/compliance/:tenantId': 'audit:read',
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
    const sep = routeKey.indexOf(':');
    if (sep === -1) continue;
    const routeMethod = routeKey.slice(0, sep);
    const routePath = routeKey.slice(sep + 1);
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
      return { ok: false, permissions: [], roleIds: [] };
    }

    const data = await response.json();

    const permissions = data.permissions || [];

    const roleIds =
      data.roleIds?.length
        ? data.roleIds
        : Array.from(
            new Set((data.roles || []).map(r => r.id).filter(Boolean))
          );

    return {
      ok: true,
      permissions,
      roleIds,
    };
  } catch (error) {
    console.error('[RBAC] Error fetching permissions:', error.message);

    return {
      ok: false,
      permissions: [],
      roleIds: [],
    };
  }
}

/**
 * Resolve permissions from cache or live RBAC.
 * On live fetch failure, do NOT cache empty permissions.
 */
async function resolvePermissions(userId, tenantId, rbacServiceUrl) {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${tenantId}`;
  const redis = getRedisClient();

  if (redis && redis.status === 'ready') {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        return { ...normalizeRbacEnvelope(JSON.parse(cached)), rbacAvailable: true };
      }
    } catch (err) {
      console.warn('[RBAC] Redis read error, falling back to live fetch:', err.message);
    }
  }

  const result = await fetchUserRbacEnvelope(userId, tenantId, rbacServiceUrl);
  if (!result.ok) {
    return { permissions: [], roleIds: [], rbacAvailable: false };
  }

  if (redis && redis.status === 'ready') {
    try {
      await redis.set(cacheKey, JSON.stringify({ permissions: result.permissions, roleIds: result.roleIds }), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      console.warn('[RBAC] Redis write error:', err.message);
    }
  }

  return { permissions: result.permissions, roleIds: result.roleIds, rbacAvailable: true };
}

// ─── Redis-backed cache (via resolvePermissions) ─────────────────────────────

export async function getUserPermissions(userId, tenantId, rbacServiceUrl) {
  const { permissions } = await resolvePermissions(userId, tenantId, rbacServiceUrl);
  return permissions;
}

/** Same resolution as getUserPermissions; includes rbacAvailable for session APIs. */
export async function getUserPermissionsWithAvailability(userId, tenantId, rbacServiceUrl) {
  return resolvePermissions(userId, tenantId, rbacServiceUrl);
}

// ─── Permission check ─────────────────────────────────────────────────────────

export function hasPermission(userPermissions, requiredPermission) {
  if (userPermissions.includes('*') || userPermissions.includes('admin:*')) return true;
  if (userPermissions.includes(requiredPermission)) return true;
  const [resource] = requiredPermission.split(':');
  if (userPermissions.includes(`${resource}:*`)) return true;
  return false;
}

/** True if the user satisfies at least one permission in the list (OR semantics). */
export function hasAnyPermission(userPermissions, requiredList) {
  if (!requiredList?.length) return true;
  return requiredList.some((p) => hasPermission(userPermissions, p));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function createRbacMiddleware(rbacServiceUrl) {
  return async function rbacMiddleware(req, res, next) {
    if (!req.user) return next();

    const requiredPermission = getRequiredPermission(req.method, req.path);
    if (!requiredPermission) return next();

    const requiredList = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];

    try {
      const { permissions: userPermissions, roleIds, rbacAvailable } = await getUserPermissionsWithAvailability(
        req.user.id,
        req.user.tenantId,
        rbacServiceUrl,
      );

      req.rbacEnvelope = { permissions: userPermissions, roleIds: roleIds || [], rbacAvailable };

      if (!rbacAvailable) {
        return res.status(503).json({
          error: {
            code: 'POLICY_UNAVAILABLE',
            message: 'Authorization checks are temporarily unavailable. Please try again later.',
          },
        });
      }

      if (!hasAnyPermission(userPermissions, requiredList)) {
        const reqLabel =
          requiredList.length === 1 ? requiredList[0] : `one of: ${requiredList.join(', ')}`;
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: `You don't have permission to perform this action. Required: ${reqLabel}`,
          },
        });
      }

      next();
    } catch (error) {
      console.error('[RBAC] Middleware error:', error);
      return res.status(503).json({
        error: {
          code: 'POLICY_UNAVAILABLE',
          message: 'Authorization checks are temporarily unavailable. Please try again later.',
        },
      });
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
