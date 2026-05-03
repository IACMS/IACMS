import prisma from '../../config/database.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import { validateUpdateUserRequest } from '../../utils/validators.js';
import { getEventBus } from '../../utils/auth.helpers.js';

const logger = new Logger('auth-service');

/**
 * GET /auth/users
 * List all users in the admin's tenant.
 */
export async function listUsers(req, res, next) {
  try {
    const { tenantId } = req.user;

    const users = await prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        userRoles: {
          select: { role: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = users.map(u => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      isActive: u.isActive,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
      role: u.userRoles?.[0]?.role ?? null,
    }));

    res.json({ users: formatted });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /auth/users/:id
 * Get a single user (must belong to the admin's tenant).
 */
export async function getUser(req, res, next) {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const user = await prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: true,
        lastLogin: true,
        createdAt: true,
        userRoles: {
          select: { role: { select: { id: true, name: true } } },
        },
        tenant: { select: { id: true, name: true, code: true } },
      },
    });

    if (!user) throw new NotFoundError('User not found');

    res.json({
      user: { ...user, role: user.userRoles?.[0]?.role ?? null, userRoles: undefined },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /auth/users/:id
 * Update profile fields (firstName, lastName, email, phone) — at least one required.
 */
export async function updateUser(req, res, next) {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const fields = validateUpdateUserRequest(req.body);

    const existing = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundError('User not found');

    if (fields.email && fields.email !== existing.email) {
      const conflict = await prisma.user.findFirst({
        where: { tenantId, email: fields.email, id: { not: id } },
      });
      if (conflict) throw new ConflictError('Email is already in use within this tenant');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: fields,
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, isActive: true },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_UPDATED, { userId: id, tenantId, action: 'updated', fields: Object.keys(fields) })
        .catch(err => logger.warn('Failed to publish user.updated event', { error: err.message }));
    }

    logger.info('User updated by admin', { targetUserId: id, adminId: req.user.id });
    res.json({ user: updated });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /auth/users/:id/role
 * Replace a user's role. Role must belong to the same tenant or be a system role.
 */
export async function assignRole(req, res, next) {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;
    const { roleId } = req.body || {};

    if (!roleId) throw new ValidationError('roleId is required');

    const user = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundError('User not found');

    const role = await prisma.role.findFirst({
      where: { id: roleId, OR: [{ tenantId }, { tenantId: null }] },
    });
    if (!role) throw new NotFoundError('Role not found or not accessible in this tenant');

    if (role.name === 'system_admin') {
      const callerRoleIds = Array.isArray(req.user.roles) ? req.user.roles : [];
      const callerRoles = await prisma.role.findMany({ where: { id: { in: callerRoleIds } } });
      if (!callerRoles.some((r) => r.name === 'system_admin')) {
        throw new ForbiddenError('Only system administrators may assign the system_admin role');
      }
    }

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: id } }),
      prisma.userRole.create({ data: { userId: id, roleId } }),
    ]);

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_UPDATED, { userId: id, tenantId, action: 'role_assigned', roleId })
        .catch(err => logger.warn('Failed to publish user.updated event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'user',
        entityId: id,
        action: 'role_assigned',
        userId: req.user.id,
        metadata: { roleId },
      }).catch(() => {});
    }

    logger.info('Role assigned by admin', { targetUserId: id, roleId, adminId: req.user.id });
    res.json({ message: 'Role assigned successfully.' });
  } catch (error) {
    next(error);
  }
}

/**
 * Shared helper: count active admins in a tenant (excluding a specific user if needed).
 * Used to prevent lockout by deactivating/deleting the last admin.
 */
async function countActiveTenantAdmins(tenantId) {
  const tenantAdminRole = await prisma.role.findFirst({
    where: { name: 'tenant_admin', tenantId: null },
  });
  if (!tenantAdminRole) return Infinity;

  const tenantAdminUserRoles = await prisma.userRole.findMany({
    where: { roleId: tenantAdminRole.id },
    select: { userId: true },
  });
  const ids = tenantAdminUserRoles.map((r) => r.userId);

  return prisma.user.count({ where: { id: { in: ids }, tenantId, isActive: true } });
}

async function isLastTenantAdmin(userId, tenantId) {
  const tenantAdminRole = await prisma.role.findFirst({
    where: { name: 'tenant_admin', tenantId: null },
  });
  if (!tenantAdminRole) return false;

  const userRoleRecord = await prisma.userRole.findFirst({
    where: { userId, roleId: tenantAdminRole.id },
  });
  if (!userRoleRecord) return false;

  const count = await countActiveTenantAdmins(tenantId);
  return count <= 1;
}

/**
 * PATCH /auth/users/:id/deactivate
 * Deactivate a user. Admin cannot deactivate themselves or the last active admin.
 */
export async function deactivateUser(req, res, next) {
  try {
    const { tenantId, id: adminId } = req.user;
    const { id } = req.params;

    if (id === adminId) throw new ValidationError('You cannot deactivate your own account');

    const user = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundError('User not found');

    if (await isLastTenantAdmin(id, tenantId)) {
      throw new ValidationError('Cannot deactivate the last active tenant administrator of this tenant');
    }

    await prisma.user.update({ where: { id }, data: { isActive: false } });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_UPDATED, { userId: id, tenantId, action: 'deactivated' })
        .catch(err => logger.warn('Failed to publish user.updated event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'user',
        entityId: id,
        action: 'user_deactivated',
        userId: adminId,
        metadata: {},
      }).catch(() => {});
    }

    logger.info('User deactivated by admin', { targetUserId: id, adminId });
    res.json({ message: 'User deactivated.' });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /auth/users/:id/reactivate
 * Reactivate a previously deactivated user.
 */
export async function reactivateUser(req, res, next) {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const user = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundError('User not found');

    await prisma.user.update({ where: { id }, data: { isActive: true } });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_UPDATED, { userId: id, tenantId, action: 'reactivated' })
        .catch(err => logger.warn('Failed to publish user.updated event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'user',
        entityId: id,
        action: 'user_reactivated',
        userId: req.user.id,
        metadata: {},
      }).catch(() => {});
    }

    logger.info('User reactivated by admin', { targetUserId: id, adminId: req.user.id });
    res.json({ message: 'User reactivated.' });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /auth/users/:id
 * Soft-delete: anonymize all PII and mark inactive. Admin cannot delete themselves
 * or the last active admin of the tenant.
 */
export async function deleteUser(req, res, next) {
  try {
    const { tenantId, id: adminId } = req.user;
    const { id } = req.params;

    if (id === adminId) throw new ValidationError('You cannot delete your own account');

    const user = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundError('User not found');

    if (await isLastTenantAdmin(id, tenantId)) {
      throw new ValidationError('Cannot delete the last active tenant administrator of this tenant');
    }

    await prisma.user.update({
      where: { id },
      data: {
        email: `deleted-${id}@deleted.invalid`,
        username: `deleted-${id}`,
        firstName: 'Deleted',
        lastName: 'User',
        phone: null,
        nationalId: null,
        isActive: false,
      },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_UPDATED, { userId: id, tenantId, action: 'deleted' })
        .catch(err => logger.warn('Failed to publish user.updated event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'user',
        entityId: id,
        action: 'user_deleted',
        userId: adminId,
        metadata: {},
      }).catch(() => {});
    }

    logger.info('User soft-deleted by admin', { targetUserId: id, adminId });
    res.json({ message: 'User deleted.' });
  } catch (error) {
    next(error);
  }
}
