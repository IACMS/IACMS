/**
 * Global (tenantId = null) `tenant_admin` — one canonical role is seeded with
 * full tenant permissions. Postgres allows multiple NULLs in @@unique([tenantId, name]),
 * so we prefer the seeded id / env override, then the role with the most permissions.
 */

export const SEEDED_TENANT_ADMIN_ROLE_ID = '55555555-5555-5555-5555-555555555555';

export async function resolveCanonicalGlobalTenantAdminRole(db) {
  const envId = process.env.TENANT_ADMIN_ROLE_ID;
  if (envId) {
    const byEnv = await db.role.findFirst({
      where: {
        id: envId,
        tenantId: null,
        name: 'tenant_admin',
        isActive: true,
      },
      include: { _count: { select: { rolePermissions: true } } },
    });
    if (byEnv) return byEnv;
  }

  const bySeed = await db.role.findFirst({
    where: {
      id: SEEDED_TENANT_ADMIN_ROLE_ID,
      tenantId: null,
      isActive: true,
    },
    include: { _count: { select: { rolePermissions: true } } },
  });
  if (bySeed) return bySeed;

  const candidates = await db.role.findMany({
    where: { name: 'tenant_admin', tenantId: null, isActive: true },
    include: { _count: { select: { rolePermissions: true } } },
  });

  if (!candidates.length) return null;

  return candidates.reduce((best, cur) =>
    cur._count.rolePermissions > best._count.rolePermissions ? cur : best
  );
}

/** All active global tenant_admin role ids — for admin safeguards if duplicates ever exist */
export async function allGlobalTenantAdminRoleIds(db) {
  const rows = await db.role.findMany({
    where: { name: 'tenant_admin', tenantId: null, isActive: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
