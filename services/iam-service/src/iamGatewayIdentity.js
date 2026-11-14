function splitHeaderList(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function hasValidInternalServiceToken(req) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  return Boolean(expected && req.headers['x-internal-service-token'] === expected);
}

function buildUserFromGatewayHeaders(req) {
  const id = req.headers['x-user-id'];
  const tenantId = req.headers['x-tenant-id'];
  if (!id || !tenantId) return null;
  const mustChangePasswordHeader = req.headers['x-must-change-password'];
  return {
    id: String(id), tenantId: String(tenantId),
    email: req.headers['x-user-email'] ? String(req.headers['x-user-email']) : null,
    roles: splitHeaderList(req.headers['x-user-roles']),
    permissions: splitHeaderList(req.headers['x-user-permissions']),
    mustChangePassword: mustChangePasswordHeader === '1' || mustChangePasswordHeader === 'true',
  };
}

async function verifyGatewayHeadersInDatabase(prisma, req) {
  const identity = buildUserFromGatewayHeaders(req);
  if (!identity) return null;
  const user = await prisma.user.findFirst({
    where: { id: identity.id, isActive: true },
    select: { id: true, tenantId: true, email: true, mustChangePassword: true, userRoles: { select: { roleId: true } } },
  });
  if (!user || user.tenantId !== identity.tenantId) return null;
  return {
    id: user.id, tenantId: user.tenantId,
    email: user.email, roles: user.userRoles.map((row) => row.roleId),
    permissions: identity.permissions, mustChangePassword: user.mustChangePassword ?? false,
  };
}

/** Compatibility adapter for requests authenticated by the IACMS gateway. */
export async function resolveGatewayIdentity(prisma, req) {
  if (!req.headers['x-user-id'] || !req.headers['x-tenant-id']) return null;
  if (hasValidInternalServiceToken(req)) return buildUserFromGatewayHeaders(req);
  if (!prisma) return null;
  return verifyGatewayHeadersInDatabase(prisma, req);
}

export async function loadUserFromGatewayHeaders(prisma, req) {
  return resolveGatewayIdentity(prisma, req);
}
