import { ForbiddenError } from '../../../../../shared/common/errors.js';

/**
 * Map FMS scopes to RBAC permission keys (resource:action) and legacy role names.
 */
const SCOPE_PERMISSIONS = {
  'file.upload': ['file:upload', 'file:admin'],
  'file.read':   ['file:read', 'file:admin'],
  'file.delete': ['file:delete', 'file:admin'],
  'file.admin':  ['file:admin'],
};

/** Role names still accepted (JWT may carry names in some direct-call paths). */
const SCOPE_ROLE_NAMES = {
  'file.upload': ['system_admin', 'tenant_admin', 'case_manager', 'intake_specialist'],
  'file.read':   ['system_admin', 'tenant_admin', 'case_manager', 'intake_specialist', 'viewer'],
  'file.delete': ['system_admin', 'tenant_admin', 'case_manager', 'intake_specialist'],
  'file.admin':  ['system_admin'],
};

function hasPermission(granted, required) {
  if (!Array.isArray(granted) || granted.length === 0) return false;
  if (granted.includes('*') || granted.includes('admin:*')) return true;
  if (granted.includes(required)) return true;
  const [resource] = required.split(':');
  if (resource && granted.includes(`${resource}:*`)) return true;
  return false;
}

function hasAnyPermission(granted, requiredList) {
  return requiredList.some((p) => hasPermission(granted, p));
}

/**
 * requireScope(scope) — checks gateway-forwarded permissions, then role names.
 *
 * Permissions come from `x-user-permissions` (RBAC) via the API gateway.
 * Role names are a secondary check for direct JWT calls that embed role names.
 */
export function requireScope(scope) {
  const requiredPerms = SCOPE_PERMISSIONS[scope] ?? [];
  const allowedRoleNames = SCOPE_ROLE_NAMES[scope] ?? [];

  return function scopeMiddleware(req, res, next) {
    if (!req.user) {
      return next(new ForbiddenError('No authenticated user on request'));
    }

    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];

    if (hasAnyPermission(permissions, requiredPerms)) {
      return next();
    }

    if (userRoles.some((role) => allowedRoleNames.includes(role))) {
      return next();
    }

    return next(
      new ForbiddenError(
        `Insufficient permissions. Required scope: ${scope} ` +
        `(one of: ${requiredPerms.join(', ') || 'n/a'}).`
      )
    );
  };
}
