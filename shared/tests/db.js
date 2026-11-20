/**
 * Database helpers for integration tests.
 */

export async function canConnect(prisma) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Load a seeded tenant user by org code and local email part (e.g. admin, case.manager1). */
export async function loadSeedUser(prisma, tenantCode, localPart = 'admin') {
  const tenant = await prisma.tenant.findFirst({ where: { code: tenantCode } });
  if (!tenant) return null;
  const email = `${localPart}@${tenantCode.toLowerCase()}.gov.example`;
  const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
  return user ? { tenant, user } : null;
}
