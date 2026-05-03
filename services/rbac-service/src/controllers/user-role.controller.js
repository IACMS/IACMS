import prisma from '../config/database.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../../../../shared/common/errors.js';

function parseRoleIdsHeader(headers) {
  const raw = headers['x-user-roles'];
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function assertMayManageRoles(actorRoleIds, tenantIdHeader, targetUserId, targetRole) {
  const actorRoles = await prisma.role.findMany({
    where: { id: { in: actorRoleIds }, isActive: true },
  });
  const actorIsSystem = actorRoles.some((r) => r.name === 'system_admin');
  const actorIsTenantAdmin = actorRoles.some((r) => r.name === 'tenant_admin');

  if (!actorIsSystem && !actorIsTenantAdmin) {
    throw new ForbiddenError('Only tenant administrators or system administrators may manage roles');
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) throw new NotFoundError('User');

  if (!actorIsSystem) {
    if (!tenantIdHeader || targetUser.tenantId !== tenantIdHeader) {
      throw new ForbiddenError('Cannot manage roles for users outside your tenant');
    }
  }

  if (targetRole?.name === 'system_admin' && !actorIsSystem) {
    throw new ForbiddenError('Only system administrators may assign or revoke the system_admin role');
  }
}

export async function assignRole(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorRoleIds = parseRoleIdsHeader(req.headers);
    const { userId, roleId, assignedBy, expiresAt } = req.body;

    if (!userId || !roleId) {
      throw new ValidationError('userId and roleId are required');
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundError('Role');

    await assertMayManageRoles(actorRoleIds, tenantId, userId, role);

    const userRole = await prisma.userRole.create({
      data: {
        userId,
        roleId,
        assignedBy: assignedBy || req.headers['x-user-id'],
        expiresAt,
      },
      include: { role: true },
    });
    res.status(201).json({ userRole });
  } catch (error) {
    next(error);
  }
}

export async function revokeRole(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorRoleIds = parseRoleIdsHeader(req.headers);
    const { userId, roleId } = req.body;

    if (!userId || !roleId) {
      throw new ValidationError('userId and roleId are required');
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundError('Role');

    await assertMayManageRoles(actorRoleIds, tenantId, userId, role);

    await prisma.userRole.deleteMany({
      where: { userId, roleId },
    });
    res.json({ message: 'Role revoked' });
  } catch (error) {
    next(error);
  }
}

export async function getUserRoles(req, res, next) {
  try {
    const userRoles = await prisma.userRole.findMany({
      where: { userId: req.params.userId },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });
    res.json({ userRoles });
  } catch (error) {
    next(error);
  }
}

export async function checkPermission(req, res, next) {
  try {
    res.json({ hasPermission: false }); // Placeholder
  } catch (error) {
    next(error);
  }
}
