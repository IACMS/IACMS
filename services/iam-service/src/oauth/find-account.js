/**
 * find-account.js
 * Resolves an account subject (user ID) to the claims object the library
 * will embed in ID tokens and UserInfo responses.
 *
 * Custom claims added beyond the standard OIDC set:
 *   tenant_id, tenant_code, organization_id, roles
 *
 * The library calls findAccount(ctx, sub, token) during:
 *   - Authorization Code exchange
 *   - Refresh Token rotation
 *   - UserInfo endpoint
 */

import prisma from '../config/database.js';
import { resolveActiveClientMembership } from './organization-access.js';
import { legacyOrganizationSystem } from '../legacyOrganizationSystem.js';

async function resolveClient(ctx, token) {
  if (ctx?.oidc?.client) return ctx.oidc.client;
  const clientId = typeof token === 'object' ? token?.clientId : token;
  if (!clientId) return null;
  return prisma.oAuthClient.findUnique({
    where: { clientId },
    select: { id: true, clientId: true, tenantId: true, iamOrganizationId: true, targetAudience: true },
  });
}

/**
 * @param {import('oidc-provider').KoaContextWithOIDC} _ctx  - Koa context (unused)
 * @param {string} sub  - subject (user ID)
 * @returns {Promise<import('oidc-provider').Account | undefined>}
 */
export async function findAccount(ctx, sub, token) {
  const client = await resolveClient(ctx, token);
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
      tenant: { select: { code: true, isActive: true } },
      userRoles: { select: { roleId: true, role: { select: { slug: true, name: true } } } },
    },
  });

  if (!user || !user.isActive) return undefined;

  const membershipAccess = client
    ? await resolveActiveClientMembership(prisma, user.id, client)
    : { required: false, allowed: true, membership: null, organization: null };
  // Organization-scoped clients require a live IAM membership. Unscoped and
  // legacy clients keep the legacy tenant-active check until cutover.
  if (membershipAccess.required && !membershipAccess.allowed) return undefined;
  if (!membershipAccess.required && !user.tenant?.isActive) return undefined;

  return {
    accountId: user.id,

    /**
     * Build the claims object.
     * `use`            — 'id_token' | 'userinfo' | 'access_token'
     * `scope`          — space-separated scopes requested by the client
     * `clientContext`  — optional client record or client ID for application-scoped roles
     */
    async claims(_use, scope, clientContext) {
      let activeAccess = membershipAccess;
      if (clientContext) {
        const resolvedContextClient =
          clientContext.iamOrganizationId !== undefined || clientContext[Symbol.for('iam_organization_id')] !== undefined
            ? clientContext
            : await resolveClient(ctx, clientContext);
        activeAccess = resolvedContextClient
          ? await resolveActiveClientMembership(prisma, user.id, resolvedContextClient)
          : membershipAccess;
      }
      if (activeAccess.required && !activeAccess.allowed) return {};

      const base = { sub: user.id };
      if (activeAccess.required) {
        base.organization_id = activeAccess.organization.id;
        // Keep the IACMS claim temporarily for clients that still expect it.
        if (legacyOrganizationSystem() && activeAccess.organization.externalSystem === legacyOrganizationSystem()) {
          base.tenant_id = activeAccess.organization.externalId;
          if (activeAccess.tenantId === user.tenantId) base.tenant_code = user.tenant?.code;
        }
      } else if (legacyOrganizationSystem() && user.tenantId) {
        base.tenant_id = user.tenantId;
        base.tenant_code = user.tenant?.code;
      }

      const scopes = scope ? scope.split(' ') : [];

      if (scopes.includes('profile')) {
        Object.assign(base, {
          given_name: user.firstName,
          family_name: user.lastName,
          name: `${user.firstName} ${user.lastName}`.trim(),
        });
        if (activeAccess.required) base.organization_name = activeAccess.organization.name;
      }

      if (scopes.includes('email')) {
        Object.assign(base, {
          email: user.email,
          email_verified: user.isEmailVerified,
        });
      }

      if (scopes.includes('roles') || scopes.includes('iam:admin')) {
        // Resolve target client to support project/application-scoped role isolation
        const clientId =
          (typeof clientContext === 'object' ? clientContext?.clientId : clientContext) ||
          ctx?.oidc?.client?.clientId ||
          token?.clientId;

        let roleRecords = [];
        let legacyRoleIds = [];
        let roleClient = null;

        if (clientId) {
          roleClient =
            typeof clientContext === 'object' && clientContext?.id
              ? clientContext
              : await prisma.oAuthClient.findUnique({
                  where: { clientId },
                  select: { id: true, targetAudience: true, tenantId: true, iamOrganizationId: true },
                });

          if (roleClient) {
            // Check if user has explicit roles assigned for this specific client application
            const appRoles = await prisma.userApplicationRole.findMany({
              where: {
                userId: user.id,
                oauthClientId: roleClient.id,
                role: { isActive: true },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
              select: { roleId: true, role: { select: { slug: true, name: true } } },
            });

            if (appRoles.length > 0) {
              roleRecords = appRoles.map((assignment) => assignment.role);
              legacyRoleIds = appRoles.map((assignment) => assignment.roleId);
            } else if (roleClient.targetAudience || activeAccess.required) {
              // Never inherit legacy tenant/domain roles for a membership-bound client.
              roleRecords = [];
            } else {
              // Check if this client has any application-scoped roles configured
              const hasAppRolesConfigured = await prisma.userApplicationRole.count({
                where: { oauthClientId: roleClient.id },
              });

              if (hasAppRolesConfigured > 0) {
                // Application-scoped roles are active for this client, and user has none -> NO access in this project
                roleRecords = [];
              } else {
                // Fallback for legacy clients prior to application role assignment migration
                roleRecords = user.userRoles.map((assignment) => assignment.role);
                legacyRoleIds = user.userRoles.map((assignment) => assignment.roleId);
              }
            }
          } else {
            roleRecords = activeAccess.required ? [] : user.userRoles.map((assignment) => assignment.role);
            legacyRoleIds = activeAccess.required ? [] : user.userRoles.map((assignment) => assignment.roleId);
          }
        } else {
          roleRecords = activeAccess.required ? [] : user.userRoles.map((assignment) => assignment.role);
          legacyRoleIds = activeAccess.required ? [] : user.userRoles.map((assignment) => assignment.roleId);
        }

        const legacySystem = legacyOrganizationSystem();
        const isLegacyIacmsClient = Boolean(
          !clientId ||
          (legacySystem && activeAccess.organization?.externalSystem === legacySystem) ||
          (legacySystem && roleClient?.tenantId && !roleClient?.iamOrganizationId),
        );

        const roleIdentifiers = roleRecords
          .map((role) => role?.slug || role?.name)
          .filter(Boolean);
        const resolvedRoles = roleIdentifiers.length ? roleIdentifiers : legacyRoleIds;
        const roleNamespace = clientId || 'iam';

        if (scopes.includes('roles')) {
          base.roles = resolvedRoles;
          if (_use === 'access_token' && isLegacyIacmsClient && roleIdentifiers.length > 0) {
            base.role_ids = [...new Set(legacyRoleIds)];
          }
        }

        const isIamAdmin = roleRecords.some((role) =>
          ['system-admin', 'iam-admin', 'system_admin'].includes(role?.slug || role?.name),
        );
        if (scopes.includes('iam:admin')) {
          base.iam_admin = isIamAdmin;
        }
      }

      return base;
    },
  };
}
