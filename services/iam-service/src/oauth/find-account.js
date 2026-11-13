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
export async function findAccount(ctx, sub, token) {
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
     * `use`            — 'id_token' | 'userinfo' | 'access_token'
     * `scope`          — space-separated scopes requested by the client
     * `clientContext`  — optional client record or client ID for application-scoped roles
     */
    async claims(_use, scope, clientContext) {
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
        // Resolve target client to support project/application-scoped role isolation
        const clientId =
          (typeof clientContext === 'object' ? clientContext?.clientId : clientContext) ||
          ctx?.oidc?.client?.clientId ||
          token?.clientId;

        let scopedRoles = [];

        if (clientId) {
          const client =
            typeof clientContext === 'object' && clientContext?.id
              ? clientContext
              : await prisma.oAuthClient.findUnique({
                  where: { clientId },
                  select: { id: true, targetAudience: true },
                });

          if (client) {
            // Check if user has explicit roles assigned for this specific client application
            const appRoles = await prisma.userApplicationRole.findMany({
              where: {
                userId: user.id,
                oauthClientId: client.id,
                role: { isActive: true },
              },
              select: { roleId: true },
            });

            if (appRoles.length > 0) {
              scopedRoles = appRoles.map((ar) => ar.roleId);
            } else if (client.targetAudience) {
              // Modern application with defined target audience: strict Zero Trust isolation
              scopedRoles = [];
            } else {
              // Check if this client has any application-scoped roles configured
              const hasAppRolesConfigured = await prisma.userApplicationRole.count({
                where: { oauthClientId: client.id },
              });

              if (hasAppRolesConfigured > 0) {
                // Application-scoped roles are active for this client, and user has none -> NO access in this project
                scopedRoles = [];
              } else {
                // Fallback for legacy clients prior to application role assignment migration
                scopedRoles = user.userRoles.map((ur) => ur.roleId);
              }
            }
          } else {
            scopedRoles = user.userRoles.map((ur) => ur.roleId);
          }
        } else {
          scopedRoles = user.userRoles.map((ur) => ur.roleId);
        }

        base.roles = scopedRoles;
      }

      if (scopes.includes('profile') && user.departmentId) {
        base.department_id = user.departmentId;
      }

      return base;
    },
  };
}
