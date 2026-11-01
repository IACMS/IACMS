/**
 * find-account.js
 * Resolves an account subject (user ID) to the claims object the library
 * will embed in ID tokens and UserInfo responses.
 *
 * Custom claims added beyond the standard OIDC set:
 *   tenant_id, tenant_code, department_id, roles
 *
 * The library calls findAccount(ctx, sub, token) during:
 *   - Authorization Code exchange
 *   - Refresh Token rotation
 *   - UserInfo endpoint
 */

import prisma from '../config/database.js';

/**
 * @param {import('oidc-provider').KoaContextWithOIDC} _ctx  - Koa context (unused)
 * @param {string} sub  - subject (user ID)
 * @returns {Promise<import('oidc-provider').Account | undefined>}
 */
export async function findAccount(_ctx, sub) {
  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      isEmailVerified: true,
      tenantId: true,
      departmentId: true,
      tenant: { select: { code: true, isActive: true } },
      userRoles: { select: { roleId: true } },
    },
  });

  // Reject inactive users or users in inactive tenants
  if (!user || !user.isActive || !user.tenant?.isActive) return undefined;

  return {
    accountId: user.id,

    /**
     * Build the claims object.
     * `use`     — 'id_token' | 'userinfo'
     * `scope`   — space-separated scopes requested by the client
     * `claims`  — voluntary / essential claims from the request
     */
    async claims(_use, scope) {
      const base = {
        sub: user.id,
        // Always included
        tenant_id: user.tenantId,
        tenant_code: user.tenant.code,
      };

      const scopes = scope ? scope.split(' ') : [];

      if (scopes.includes('profile')) {
        Object.assign(base, {
          given_name: user.firstName,
          family_name: user.lastName,
          name: `${user.firstName} ${user.lastName}`.trim(),
        });
      }

      if (scopes.includes('email')) {
        Object.assign(base, {
          email: user.email,
          email_verified: user.isEmailVerified,
        });
      }

      if (scopes.includes('roles')) {
        base.roles = user.userRoles.map((ur) => ur.roleId);
      }

      if (scopes.includes('profile') && user.departmentId) {
        base.department_id = user.departmentId;
      }

      return base;
    },
  };
}
