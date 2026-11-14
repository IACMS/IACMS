import { legacyOrganizationSystem } from './legacyOrganizationSystem.js';

/**
 * Maintain the generic IAM membership bridge for an account still provisioned
 * through the legacy tenant APIs. Call with the same Prisma transaction that
 * writes the user so the compatibility records cannot drift on account create.
 */
export async function syncLegacyTenantMembership(db, { tenant, user }) {
  if (process.env.IAM_ORG_MEMBERSHIPS_ENABLED !== 'true') return null;
  const legacySystem = legacyOrganizationSystem();
  if (!legacySystem) return null;
  if (!tenant?.id || !tenant?.name || !tenant?.code || !user?.id) {
    throw new Error('Tenant and user are required to synchronize an IAM membership');
  }

  const organization = await db.iamOrganization.upsert({
    where: {
      externalSystem_externalId: {
        externalSystem: legacySystem,
        externalId: tenant.id,
      },
    },
    create: {
      name: tenant.name,
      slug: `${legacySystem}-${tenant.code.toLowerCase()}`,
      externalSystem: legacySystem,
      externalId: tenant.id,
      isActive: tenant.isActive,
    },
    update: {},
  });

  return db.iamMembership.upsert({
    where: {
      subjectId_organizationId: {
        subjectId: user.id,
        organizationId: organization.id,
      },
    },
    create: {
      subjectId: user.id,
      organizationId: organization.id,
      status: user.isActive && tenant.isActive ? 'active' : 'inactive',
      externalSystem: legacySystem,
    },
    update: {},
  });
}

