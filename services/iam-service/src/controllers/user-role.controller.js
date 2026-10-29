import prisma from '../config/database.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../../../../shared/common/errors.js';
import { loadUserRoleIdsForUser } from '../../../../shared/utils/userRoles.js';

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

async function actorRoleIdsFromRequest(req) {
  let ids = parseRoleIdsHeader(req.headers);
  const actorUserId = req.headers['x-user-id'];
  if ((!ids || !ids.length) && actorUserId) {
    ids = await loadUserRoleIdsForUser(prisma, actorUserId);
  }
  return ids;
}

export async function assignRole(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorRoleIds = await actorRoleIdsFromRequest(req);
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
    const actorRoleIds = await actorRoleIdsFromRequest(req);
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
    const tenantId = req.headers['x-tenant-id'] || req.user?.tenantId;
    const actorRoleIds = await actorRoleIdsFromRequest(req);
    const actorRoles = await prisma.role.findMany({
      where: { id: { in: actorRoleIds }, isActive: true },
    });
    const actorIsSystem = actorRoles.some((r) => r.name === 'system_admin');
    const actorIsTenantAdmin = actorRoles.some((r) => r.name === 'tenant_admin');
    const targetUserId = req.params.userId;
    const actorUserId = req.headers['x-user-id'] || req.user?.id;

    if (!actorIsSystem && !actorIsTenantAdmin && actorUserId !== targetUserId) {
      throw new ForbiddenError('Only administrators may view user roles');
    }

    const where = {
      userId: targetUserId,
      ...(actorIsSystem ? {} : { user: { tenantId } }),
    };

    const userRoles = await prisma.userRole.findMany({
      where,
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
    const { userId, resource, action, permission } = req.body;
    let resName = resource;
    let actName = action;

    if (!resName && !actName && permission && typeof permission === 'string') {
      const parts = permission.split(':');
      resName = parts[0];
      actName = parts[1];
    }

    if (!userId || !resName || !actName) {
      throw new ValidationError('userId, resource, and action (or permission) are required');
    }

    const userRoles = await prisma.userRole.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
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

    const hasPermission = userRoles.some((userRole) => {
      if (!userRole.role?.isActive) return false;
      return userRole.role.rolePermissions.some(
        (rp) =>
          rp.permission &&
          rp.permission.resource === resName &&
          rp.permission.action === actName
      );
    });

    res.json({ hasPermission, userId, permission: `${resName}:${actName}` });
  } catch (error) {
    next(error);
  }
}
