import { PrismaClient } from '../src/generated/prisma/client.js';
import { legacyOrganizationSystem } from '../src/legacyOrganizationSystem.js';

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const applyRequested = args.has('--apply');
const confirmApply = process.env.IAM_MEMBERSHIP_BACKFILL_CONFIRM === 'apply';
const legacySystem = legacyOrganizationSystem();
const batchSize = 250;

if ([...args].some((arg) => !['--apply', '--dry-run'].includes(arg)) || (args.has('--apply') && args.has('--dry-run'))) {
  throw new Error('Usage: node scripts/backfill-legacy-iam-memberships.js [--dry-run | --apply]');
}
if (applyRequested && !confirmApply) {
  throw new Error('Applying requires both --apply and IAM_MEMBERSHIP_BACKFILL_CONFIRM=apply');
}
if (!legacySystem) {
  throw new Error('Set IAM_LEGACY_ORGANIZATION_SYSTEM to the source application before running this legacy data backfill');
}

try {
  const [tenants, identityCount] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    }),
    prisma.user.count({ where: { tenantId: { not: null } } }),
  ]);

  if (!applyRequested) {
    const existingOrganizations = tenants.length
      ? await prisma.iamOrganization.count({
          where: {
            externalSystem: legacySystem,
            externalId: { in: tenants.map(({ id }) => id) },
          },
        })
      : 0;
    console.log(JSON.stringify({
      mode: 'dry-run',
      legacyTenantCount: tenants.length,
      legacyIdentityCount: identityCount,
      mappedOrganizationCount: existingOrganizations,
      organizationCountToCreate: tenants.length - existingOrganizations,
      writesPerformed: 0,
    }, null, 2));
  } else {
    let organizationsCreated = 0;
    let membershipsProcessed = 0;

    for (const tenant of tenants) {
      const mappingKey = {
        externalSystem_externalId: {
          externalSystem: legacySystem,
          externalId: tenant.id,
        },
      };
      const existingOrganization = await prisma.iamOrganization.findUnique({
        where: mappingKey,
        select: { id: true },
      });
      const organization = await prisma.iamOrganization.upsert({
        where: mappingKey,
        create: {
          name: tenant.name,
          slug: `${legacySystem}-${tenant.code.toLowerCase()}`,
          externalSystem: legacySystem,
          externalId: tenant.id,
          isActive: tenant.isActive,
        },
        // Preserve any IAM-side name or status edits on reruns.
        update: {},
      });
      if (!existingOrganization) organizationsCreated += 1;

      let cursor = null;
      while (true) {
        const identities = await prisma.user.findMany({
          where: { tenantId: tenant.id, ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: 'asc' },
          take: batchSize,
          select: { id: true, isActive: true },
        });
        if (!identities.length) break;

        await prisma.$transaction(identities.map((identity) => prisma.iamMembership.upsert({
          where: {
            subjectId_organizationId: {
              subjectId: identity.id,
              organizationId: organization.id,
            },
          },
          create: {
            subjectId: identity.id,
            organizationId: organization.id,
            status: identity.isActive ? 'active' : 'inactive',
        externalSystem: legacySystem,
          },
          // The migration is additive. On reruns, keep membership lifecycle
          // decisions already made in IAM instead of reactivating accounts.
          update: {},
        })));
        membershipsProcessed += identities.length;
        cursor = identities[identities.length - 1].id;
      }
    }

    console.log(JSON.stringify({
      mode: 'applied',
      organizationsCreated,
      membershipsProcessed,
      credentialsCopied: false,
      writesAreAdditiveAndIdempotent: true,
    }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
