/**
 * Load RBAC role IDs for a user from the database (authoritative when gateway
 * omitted `x-user-roles`, e.g. older sessions or partial JWT payloads).
 */

export async function loadUserRoleIdsForUser(prisma, userId) {
  if (!userId) return [];
  const rows = await prisma.userRole.findMany({
    where: { userId: String(userId) },
    select: { roleId: true },
  });
  return rows.map((r) => r.roleId);
}
