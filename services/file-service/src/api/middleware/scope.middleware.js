import { ForbiddenError } from '../../../../shared/common/errors.js';

/**
 * Scope-to-role mapping.
 * Defines which roles satisfy each file scope.
 *
 * Phase 2: permissive defaults — authenticated users pass all read checks.
 * Phase 5: tighten these by integrating with the RBAC service permission table,
 *          requiring explicit file.* permissions assigned to the user's roles.
 */
const SCOPE_ROLES = {
  'file.upload': ['system_admin', 'tenant_admin', 'case_manager', 'file.upload', 'file.admin'],
  'file.read':   ['system_admin', 'tenant_admin', 'case_manager', 'viewer',      'file.read',   'file.admin'],
  'file.delete': ['system_admin', 'tenant_admin', 'case_manager',                'file.delete', 'file.admin'],
  'file.admin':  ['system_admin',                                                 'file.admin'],
};

/**
 * requireScope(scope) — middleware factory.
 *
 * Returns a middleware that checks whether the authenticated user has one of
 * the roles that satisfies the required scope.
 *
 * The user's roles come from:
 *   - JWT claim `roles[]` (direct API calls)
 *   - `x-user-roles` header (gateway-proxied calls, comma-separated role IDs/names)
 *
 * If req.user has no roles array, the check falls back to allowing the request
 * through for read operations (phase 2 permissive policy).
 *
 * @param {'file.upload'|'file.read'|'file.delete'|'file.admin'} scope
 */
export function requireScope(scope) {
  const allowedRoles = SCOPE_ROLES[scope] ?? [];

  return function scopeMiddleware(req, res, next) {
    if (!req.user) {
      // authenticateToken runs before this — if we get here without req.user it is a bug
      return next(new ForbiddenError('No authenticated user on request'));
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];

    // file.admin bypasses all scope checks
    if (userRoles.includes('file.admin')) return next();

    // Check if any of the user's roles satisfies the required scope
    const hasScope = userRoles.some((role) => allowedRoles.includes(role));
    if (hasScope) return next();

    // Phase 2 permissive fallback:
    // Allow any authenticated user to read/upload.
    // Only delete requires an explicit matching role.
    // This will be removed in Phase 5 once RBAC is fully wired.
    if (scope === 'file.read' || scope === 'file.upload') {
      return next();
    }

    return next(
      new ForbiddenError(
        `Insufficient permissions. Required scope: ${scope}. ` +
        `Your roles: [${userRoles.join(', ') || 'none'}]`
      )
    );
  };
}
