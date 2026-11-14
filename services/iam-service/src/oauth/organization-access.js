import { legacyOrganizationSystem } from '../legacyOrganizationSystem.js';
const membershipsEnabled = () => process.env.IAM_ORG_MEMBERSHIPS_ENABLED === 'true';

function organizationIdOf(client) {
  return client?.iamOrganizationId || client?.[Symbol.for('iam_organization_id')] || null;
}

function tenantIdOf(client) {
  return client?.tenantId || client?.[Symbol.for('tenant_id')] || null;
}

/** Resolve an OAuth client's IAM organization, including the legacy tenant map. */
export async function resolveClientOrganization(db, client) {
  const organizationId = organizationIdOf(client);
  const tenantId = tenantIdOf(client);

  if (organizationId) {
    const organization = await db.iamOrganization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true, isActive: true, externalSystem: true, externalId: true },
    });
    return { required: true, organization, tenantId };
  }

  if (tenantId && membershipsEnabled()) {
    const externalSystem = legacyOrganizationSystem();
    if (!externalSystem) return { required: true, organization: null, tenantId };
    const organization = await db.iamOrganization.findUnique({
      where: {
        externalSystem_externalId: {
          externalSystem,
          externalId: tenantId,
        },
      },
      select: { id: true, name: true, slug: true, isActive: true, externalSystem: true, externalId: true },
    });
    return { required: true, organization, tenantId };
  }

  return { required: false, organization: null, tenantId };
}

/** Return the single active IAM organization membership for a subject/client. */
export async function resolveActiveClientMembership(db, subjectId, client) {
  const context = await resolveClientOrganization(db, client);
  if (!context.required) return { ...context, membership: null, allowed: true };
  if (!context.organization?.isActive) return { ...context, membership: null, allowed: false };

  const membership = await db.iamMembership.findUnique({
    where: {
      subjectId_organizationId: {
        subjectId,
        organizationId: context.organization.id,
      },
    },
    select: { id: true, subjectId: true, organizationId: true, status: true },
  });
  return {
    ...context,
    membership,
    allowed: membership?.status === 'active',
  };
}

/** Resolve credentials against the org selected by the OAuth client. */
export async function findUserForOAuthClient(db, email, client) {
  const context = await resolveClientOrganization(db, client);

  if (context.required) {
    if (!context.organization?.isActive) return null;
    const memberships = await db.iamMembership.findMany({
      where: {
        organizationId: context.organization.id,
        status: 'active',
        subject: { is: { email, isActive: true } },
      },
      select: { subjectId: true },
      take: 2,
    });
    if (memberships.length !== 1) return null;
    const user = await db.user.findUnique({
      where: { id: memberships[0].subjectId },
      include: { tenant: { select: { code: true, isActive: true } }, userRoles: { select: { roleId: true } } },
    });
    return user?.isActive && user.email === email ? user : null;
  }

  const where = { email, isActive: true };
  if (context.tenantId) where.tenantId = context.tenantId;
  const user = await db.user.findFirst({
    where,
    include: { tenant: { select: { code: true, isActive: true } }, userRoles: { select: { roleId: true } } },
  });
  if (context.tenantId && user?.tenantId !== context.tenantId) return null;
  return user;
}
