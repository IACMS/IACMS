import '../env.js';
import crypto from 'node:crypto';

/**
 * Constant-time string equality check to prevent timing attacks.
 */
export function timingSafeMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Verifies whether the request carries a valid x-internal-service-token header.
 */
export function hasValidInternalToken(req) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN || (process.env.NODE_ENV !== 'production' ? 'iacms-internal-service-token-dev' : undefined);
  if (!expected) return false;
  return timingSafeMatch(req?.headers?.['x-internal-service-token'], expected);
}

/**
 * Derives whether the caller has platform admin privileges.
 * NEVER trusts raw x-user-* headers unless a valid internal service token is present.
 */
export function isPlatformAdminRequest(req) {
  if (req?.iamAdminAuthorized === true) return true;

  if (hasValidInternalToken(req)) {
    const rawPerms = req?.headers?.['x-user-permissions'] || '';
    const permissions = Array.isArray(rawPerms) ? rawPerms.join(',') : String(rawPerms);
    if (permissions.split(/[\s,]+/).some((p) => ['platform:manage_tenants', '*', 'admin:*'].includes(p))) {
      return true;
    }

    const rawRoles = req?.headers?.['x-user-roles'] || '';
    const roles = Array.isArray(rawRoles) ? rawRoles.join(',') : String(rawRoles);
    if (roles.split(/[\s,]+/).some((r) => ['system_admin', 'system-admin', 'iam-admin'].includes(r))) {
      return true;
    }
  }

  // Fall back to server-computed user identity
  const userRoles = Array.isArray(req?.user?.roles) ? req.user.roles : [];
  const userPerms = Array.isArray(req?.user?.permissions) ? req.user.permissions : [];
  return (
    userPerms.some((p) => ['platform:manage_tenants', '*', 'admin:*'].includes(p)) ||
    userRoles.some((r) => ['system_admin', 'system-admin', 'iam-admin'].includes(r))
  );
}
