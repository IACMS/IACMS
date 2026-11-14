export async function loadUserRoleIdsForUser(prisma, userId) {
  if (!userId) return [];
  const rows = await prisma.userRole.findMany({ where: { userId: String(userId) }, select: { roleId: true } });
  return rows.map((row) => row.roleId);
}
