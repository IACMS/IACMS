import { ForbiddenError } from '../../../../../shared/common/errors.js';

/**
 * Map FMS scopes to RBAC permission keys (resource:action) and legacy role names.
 */
const SCOPE_PERMISSIONS = {
  'file.upload': ['file:upload', 'file:admin', 'files:write', 'files:*'],
  'file.read':   ['file:read', 'file:admin', 'files:read', 'files:*'],
  'file.delete': ['file:delete', 'file:admin', 'files:delete', 'files:*'],
  'file.admin':  ['file:admin', 'files:*'],
};

/** OAuth 2.0 / OIDC standard scopes mapped to file actions. */
const SCOPE_OAUTH_SCOPES = {
  'file.upload': ['files:write', 'files:upload', 'files:*', '*'],
  'file.read':   ['files:read', 'files:*', '*'],
  'file.delete': ['files:delete', 'files:*', '*'],
  'file.admin':  ['files:admin', 'files:*', '*'],
};

/** Role names still accepted (JWT may carry names in some direct-call paths). */
const SCOPE_ROLE_NAMES = {
  'file.upload': ['system_admin', 'tenant_admin', 'case_manager', 'intake_specialist', 'supervisor'],
  'file.read':   ['system_admin', 'tenant_admin', 'case_manager', 'intake_specialist', 'supervisor', 'viewer'],
  'file.delete': ['system_admin', 'tenant_admin', 'case_manager', 'intake_specialist', 'supervisor'],
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

function hasAnyScope(grantedScopes, requiredScopes) {
  if (!Array.isArray(grantedScopes) || grantedScopes.length === 0) return false;
  if (grantedScopes.includes('*')) return true;
  return requiredScopes.some((reqScope) => {
    if (grantedScopes.includes(reqScope)) return true;
    const [prefix] = reqScope.split(':');
    return prefix && grantedScopes.includes(`${prefix}:*`);
  });
}

/**
 * requireScope(scope) — checks OAuth scopes, gateway-forwarded permissions, then role names.
 *
 * 1. OAuth scopes (`req.user.scopes`) — from direct OAuth 2.0 bearer tokens or API keys.
 * 2. Permissions (`x-user-permissions`) — from API gateway RBAC resolution.
 * 3. Role names (`req.user.roles`) — fallback for administrative roles.
 */
export function requireScope(scope) {
  const requiredPerms = SCOPE_PERMISSIONS[scope] ?? [];
  const requiredOAuth = SCOPE_OAUTH_SCOPES[scope] ?? [];
  const allowedRoleNames = SCOPE_ROLE_NAMES[scope] ?? [];

  return function scopeMiddleware(req, res, next) {
    if (!req.user) {
      return next(new ForbiddenError('No authenticated user on request'));
    }

    // 1. Check OAuth 2.0 scopes
    const scopes = Array.isArray(req.user.scopes) ? req.user.scopes : [];
    if (hasAnyScope(scopes, requiredOAuth)) {
      return next();
    }

    // 2. Check RBAC permissions
    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (hasAnyPermission(permissions, requiredPerms)) {
      return next();
    }

    // 3. Check administrative / allowed roles
    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];
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
