import prisma from '../config/database.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../../../shared/common/errors.js';

export const PLATFORM_TENANT_CODE = 'ADMIN';

function parseRoleIdsFromHeaders(req) {
  const raw = req.headers['x-user-roles'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function parsePermissionsFromHeaders(req) {
  const raw = req.headers['x-user-permissions'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

export async function resolvePlatformActor(req) {
  const actorUserId =
    (req.headers['x-user-id'] && String(req.headers['x-user-id'])) || req.user?.id || null;
  const actorTenantId =
    (req.headers['x-tenant-id'] && String(req.headers['x-tenant-id'])) || req.user?.tenantId || null;

  if (!actorUserId || !actorTenantId) {
    throw new ValidationError('Tenant ID and User ID are required in headers');
  }

  const permissions = parsePermissionsFromHeaders(req);
  const hasPlatformPerm =
    permissions.includes('platform:manage_tenants') ||
    permissions.includes('*') ||
    permissions.includes('admin:*');

  let isSystemAdmin = hasPlatformPerm;

  if (!isSystemAdmin) {
    const roleIds = parseRoleIdsFromHeaders(req);
    const fromJwt = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : [];
    const allRoleIds = [...new Set([...roleIds, ...fromJwt])];
    if (allRoleIds.length) {
      const roles = await prisma.role.findMany({
        where: { id: { in: allRoleIds }, isActive: true },
        select: { name: true },
      });
      isSystemAdmin = roles.some((r) => r.name === 'system_admin');
    }
  }

  if (!isSystemAdmin) {
    throw new ForbiddenError('Only platform administrators may perform this action');
  }

  return { actorUserId, actorTenantId };
}

export async function assertNotPlatformTenant(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { code: true },
  });
  if (!tenant) return;
  if (tenant.code === PLATFORM_TENANT_CODE) {
    throw new ValidationError(`The platform tenant (${PLATFORM_TENANT_CODE}) cannot be modified in this way`);
  }
}
