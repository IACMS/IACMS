/**
 * RBAC Middleware for API Gateway
 * Checks user permissions before allowing access to protected resources
 */

/**
 * Route permission mappings
 * Maps HTTP method + path patterns to required permissions
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

/**
 * Cache for user permissions (simple in-memory cache)
 * In production, use Redis or similar
 */
const permissionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Match a path pattern against actual path
 * e.g., '/api/v1/cases/:id' matches '/api/v1/cases/123'
 */
function matchPath(pattern, actualPath) {
  const patternParts = pattern.split('/');
  const actualParts = actualPath.split('/');

  if (patternParts.length !== actualParts.length) {
    return false;
  }

  return patternParts.every((part, index) => {
    // :param matches any value
    if (part.startsWith(':')) return true;
    return part === actualParts[index];
  });
}

/**
 * Get required permission for a route
 */
function getRequiredPermission(method, path) {
  // First try exact match
  const exactKey = `${method}:${path}`;
  if (ROUTE_PERMISSIONS[exactKey]) {
    return ROUTE_PERMISSIONS[exactKey];
  }

  // Then try pattern matching
  for (const [routeKey, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    const [routeMethod, routePath] = routeKey.split(':');
    if (routeMethod === method && matchPath(routePath, path)) {
      return permission;
    }
  }

  return null;
}

/**
 * Fetch user permissions from RBAC service
 */
async function fetchUserPermissions(userId, tenantId, rbacServiceUrl) {
  try {
    const response = await fetch(
      `${rbacServiceUrl}/permissions/user/${userId}`,
      {
        headers: {
          'x-user-id': userId,
          'x-tenant-id': tenantId,
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch permissions:', response.status);
      return [];
    }

    const data = await response.json();
    return data.permissions || [];
  } catch (error) {
    console.error('Error fetching permissions:', error.message);
    return [];
  }
}

/**
 * Get user permissions with caching
 */
async function getUserPermissions(userId, tenantId, rbacServiceUrl) {
  const cacheKey = `${userId}:${tenantId}`;
  const cached = permissionCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.permissions;
  }

  const permissions = await fetchUserPermissions(userId, tenantId, rbacServiceUrl);
  
  permissionCache.set(cacheKey, {
    permissions,
    timestamp: Date.now(),
  });

  return permissions;
}

/**
 * Check if user has required permission
 */
function hasPermission(userPermissions, requiredPermission) {
  // Admin role typically has all permissions
  if (userPermissions.includes('*') || userPermissions.includes('admin:*')) {
    return true;
  }

  // Check for exact permission
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  // Check for wildcard permission (e.g., 'cases:*' allows 'cases:read')
  const [resource] = requiredPermission.split(':');
  if (userPermissions.includes(`${resource}:*`)) {
    return true;
  }

  return false;
}

/**
 * Create RBAC middleware
 */
export function createRbacMiddleware(rbacServiceUrl) {
  return async function rbacMiddleware(req, res, next) {
    // Skip if no user (public routes)
    if (!req.user) {
      return next();
    }

    // Get required permission for this route
    const requiredPermission = getRequiredPermission(req.method, req.path);

    // If no permission mapping, allow access (route not protected by RBAC)
    if (!requiredPermission) {
      return next();
    }

    try {
      // Get user permissions
      const userPermissions = await getUserPermissions(
        req.user.id,
        req.user.tenantId,
        rbacServiceUrl
      );

      // Check permission
      if (!hasPermission(userPermissions, requiredPermission)) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: `You don't have permission to perform this action. Required: ${requiredPermission}`,
          },
        });
      }

      // Permission granted, continue
      next();
    } catch (error) {
      console.error('RBAC middleware error:', error);
      // Fail open for now (allow access if RBAC check fails)
      // In production, you might want to fail closed (deny access)
      next();
    }
  };
}

/**
 * Clear permission cache for a user
 */
export function clearPermissionCache(userId, tenantId) {
  const cacheKey = `${userId}:${tenantId}`;
  permissionCache.delete(cacheKey);
}

/**
 * Clear all permission cache
 */
export function clearAllPermissionCache() {
  permissionCache.clear();
}

export default createRbacMiddleware;
