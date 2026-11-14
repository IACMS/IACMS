import prisma from '../config/database.js';
import { clearAllPermissionCache, clearPermissionCache } from '../middleware/rbac.middleware.js';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../../../shared/common/errors.js';

const roleInclude = { rolePermissions: { include: { permission: true } } };

function actor(req) {
  if (!req.user?.id) throw new UnauthorizedError();
  return { id: String(req.user.id), tenantId: req.user.tenantId ? String(req.user.tenantId) : null };
}

function isPlatformAdmin(req) {
  return Boolean(req.rbacEnvelope?.permissions?.includes('platform:manage_tenants'));
}

function canManageRoles(req) {
  const roles = req.rbacEnvelope?.roleIds || [];
  return prisma.role.findMany({
    where: { id: { in: roles }, isActive: true },
    select: { name: true },
  }).then((rows) => rows.some((row) => row.name === 'tenant_admin' || row.name === 'system_admin'));
}

function assertRoleTenant(req, role) {
  const { tenantId } = actor(req);
  if (!isPlatformAdmin(req) && (!tenantId || role.tenantId !== tenantId)) {
    throw new NotFoundError('Role');
  }
  if (!isPlatformAdmin(req) && role.isSystemRole) throw new ForbiddenError('Only platform administrators can manage system roles');
}

async function assertPermissionIds(req, permissionIds = []) {
  if (!Array.isArray(permissionIds)) throw new ValidationError('permissionIds must be an array');
  const uniqueIds = [...new Set(permissionIds.map(String))];
  if (!uniqueIds.length) return uniqueIds;
  const permissions = await prisma.permission.findMany({ where: { id: { in: uniqueIds } } });
  if (permissions.length !== uniqueIds.length) throw new NotFoundError('Permission');
  if (!isPlatformAdmin(req) && permissions.some((permission) => permission.resource === 'platform')) {
    throw new ForbiddenError('Only platform administrators can grant platform permissions');
  }
  return uniqueIds;
}

export async function getRoles(req, res, next) {
  try {
    const { tenantId: callerTenant } = actor(req);
    const requestedTenant = req.query.tenantId ? String(req.query.tenantId) : callerTenant;
    if (!isPlatformAdmin(req) && requestedTenant !== callerTenant) throw new ForbiddenError('Cannot read roles for another organization');
    let where = {};
    if (requestedTenant) where = { OR: [{ tenantId: null }, { tenantId: requestedTenant }] };
    else if (!isPlatformAdmin(req)) where = { tenantId: null };
    if (!isPlatformAdmin(req)) {
      where.rolePermissions = { none: { permission: { resource: 'platform' } } };
    }
    const roles = await prisma.role.findMany({ where, include: roleInclude, orderBy: [{ name: 'asc' }] });
    res.json({ roles });
  } catch (error) { next(error); }
}

export async function getRole(req, res, next) {
  try {
    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: roleInclude });
    if (!role) throw new NotFoundError('Role');
    const callerTenant = actor(req).tenantId;
    if (!isPlatformAdmin(req) && role.tenantId && role.tenantId !== callerTenant) throw new NotFoundError('Role');
    if (!isPlatformAdmin(req) && role.rolePermissions.some(({ permission }) => permission.resource === 'platform')) {
      throw new NotFoundError('Role');
    }
    res.json({ role });
  } catch (error) { next(error); }
}

export async function createRole(req, res, next) {
  try {
    const { tenantId } = actor(req);
    const { name, description, permissionIds = [], tenantId: requestedTenant, isSystemRole = false } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) throw new ValidationError('Role name is required');
    if (!isPlatformAdmin(req) && requestedTenant && String(requestedTenant) !== tenantId) {
      throw new ForbiddenError('Cannot create a role for another organization');
    }
    if (!isPlatformAdmin(req) && !tenantId) throw new ValidationError('An organization is required to create an IACMS role');
    if (!isPlatformAdmin(req) && isSystemRole) throw new ForbiddenError('Only platform administrators can create system roles');
    const permissions = await assertPermissionIds(req, permissionIds);
    const role = await prisma.role.create({
      data: {
        name: name.trim(),
        description: description || null,
        tenantId: isPlatformAdmin(req) ? (requestedTenant ? String(requestedTenant) : null) : tenantId,
        isSystemRole: Boolean(isSystemRole),
        rolePermissions: { create: permissions.map((permissionId) => ({ permissionId })) },
      },
      include: roleInclude,
    });
    await clearAllPermissionCache();
    res.status(201).json({ role });
  } catch (error) { next(error); }
}

export async function updateRole(req, res, next) {
  try {
    const roleId = req.params.id;
    const existing = await prisma.role.findUnique({ where: { id: roleId }, include: roleInclude });
    if (!existing) throw new NotFoundError('Role');
    assertRoleTenant(req, existing);
    const { name, description, permissionIds } = req.body ?? {};
    const permissions = permissionIds === undefined ? null : await assertPermissionIds(req, permissionIds);
    const role = await prisma.$transaction(async (tx) => {
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissions.length) {
          await tx.rolePermission.createMany({ data: permissions.map((permissionId) => ({ roleId, permissionId })) });
        }
      }
      return tx.role.update({
        where: { id: roleId },
        data: {
          ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description: description || null } : {}),
        },
        include: roleInclude,
      });
    });
    await clearAllPermissionCache();
    res.json({ role });
  } catch (error) { next(error); }
}

export async function deleteRole(req, res, next) {
  try {
    const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Role');
    assertRoleTenant(req, existing);
    if (!isPlatformAdmin(req) && existing.name === 'tenant_admin') throw new ForbiddenError('Cannot delete the tenant administrator role');
    await prisma.role.delete({ where: { id: existing.id } });
    await clearAllPermissionCache();
    res.json({ message: 'Role deleted' });
  } catch (error) { next(error); }
}

export async function getPermissions(req, res, next) {
  try {
    const where = isPlatformAdmin(req) ? {} : { NOT: { resource: 'platform' } };
    const permissions = await prisma.permission.findMany({ where, orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
    res.json({ permissions });
  } catch (error) { next(error); }
}

export async function getPermission(req, res, next) {
  try {
    const permission = await prisma.permission.findUnique({ where: { id: req.params.id } });
    if (!permission || (!isPlatformAdmin(req) && permission.resource === 'platform')) {
      throw new NotFoundError('Permission');
    }
    res.json({ permission });
  } catch (error) { next(error); }
}

export async function addRolePermission(req, res, next) {
  try {
    const { roleId, permissionId } = req.body ?? {};
    if (!roleId || !permissionId) throw new ValidationError('roleId and permissionId are required');
    const role = await prisma.role.findUnique({ where: { id: String(roleId) } });
    if (!role) throw new NotFoundError('Role');
    assertRoleTenant(req, role);
    const [permission] = await assertPermissionIds(req, [permissionId]).then((ids) =>
      prisma.permission.findMany({ where: { id: { in: ids } } }),
    );
    const row = await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      create: { roleId: role.id, permissionId: permission.id },
      update: {},
      include: { permission: true },
    });
    await clearAllPermissionCache();
    res.status(201).json({ rolePermission: row });
  } catch (error) { next(error); }
}

export async function removeRolePermission(req, res, next) {
  try {
    const { roleId, permissionId } = req.params;
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundError('Role');
    assertRoleTenant(req, role);
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
    await clearAllPermissionCache();
    res.json({ message: 'Permission removed from role' });
  } catch (error) { next(error); }
}

async function assertMayAssign(req, targetUserId, role) {
  const { id: actorId, tenantId } = actor(req);
  const isPlatform = isPlatformAdmin(req);
  const elevated = await canManageRoles(req);
  if (!isPlatform && !elevated) throw new ForbiddenError('Only tenant administrators may manage role assignments');
  if (!tenantId) throw new ValidationError('An organization is required for IACMS role assignments');
  if (!isPlatform && role.tenantId !== tenantId) throw new NotFoundError('Role');
  if (!isPlatform && role.isSystemRole) throw new ForbiddenError('Only platform administrators may assign system roles');
  if (role.name === 'system_admin' && !isPlatform) throw new ForbiddenError('Only platform administrators may assign system_admin');
  const identity = await prisma.identityProjection.findUnique({
    where: { subjectId_tenantId: { subjectId: String(targetUserId), tenantId } },
    select: { subjectId: true, isActive: true, deletedAt: true },
  });
  if (!identity || !identity.isActive || identity.deletedAt) throw new NotFoundError('Active organization identity');
  return { actorId, tenantId };
}

/** Preflight tenant and actor checks before IAM creates an external account. */
export async function assertProjectRoleAssignmentAllowed(req, role) {
  const { tenantId } = actor(req);
  const isPlatform = isPlatformAdmin(req);
  const elevated = await canManageRoles(req);
  if (!isPlatform && !elevated) throw new ForbiddenError('Only tenant administrators may manage role assignments');
  if (!tenantId) throw new ValidationError('An organization is required for IACMS role assignments');
  if (!isPlatform && role.tenantId !== tenantId) throw new NotFoundError('Role');
  if (!isPlatform && role.isSystemRole) throw new ForbiddenError('Only platform administrators may assign system roles');
  if (role.name === 'system_admin' && !isPlatform) throw new ForbiddenError('Only platform administrators may assign system_admin');
  return { actorId: actor(req).id, tenantId };
}

/** Add a local project role to an already projected IAM subject. */
export async function assignProjectRoleToIdentity({ actorId, tenantId, subjectId, role, db = prisma, clearCache = true }) {
  const identity = await db.identityProjection.findUnique({
    where: { subjectId_tenantId: { subjectId: String(subjectId), tenantId: String(tenantId) } },
    select: { subjectId: true, isActive: true, deletedAt: true },
  });
  if (!identity || !identity.isActive || identity.deletedAt) throw new NotFoundError('Active organization identity');
  const userRole = await db.userRole.create({
    data: { userId: String(subjectId), roleId: role.id, assignedBy: String(actorId) },
    include: { role: { include: roleInclude } },
  });
  if (clearCache) await clearPermissionCache(String(subjectId), String(tenantId));
  return userRole;
}

export async function assignUserRole(req, res, next) {
  try {
    const { userId, roleId, expiresAt } = req.body ?? {};
    if (!userId || !roleId) throw new ValidationError('userId and roleId are required');
    const role = await prisma.role.findUnique({ where: { id: String(roleId) } });
    if (!role || !role.isActive) throw new NotFoundError('Active role');
    const { actorId, tenantId } = await assertMayAssign(req, userId, role);
    const userRole = await prisma.userRole.create({
      data: {
        userId: String(userId), roleId: role.id, assignedBy: actorId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      include: { role: { include: roleInclude } },
    });
    await clearPermissionCache(String(userId), tenantId);
    res.status(201).json({ userRole });
  } catch (error) {
    if (error?.code === 'P2002') return next(new ConflictError('This user already has that role'));
    next(error);
  }
}

export async function replaceUserRole(req, res, next) {
  try {
    const targetUserId = String(req.params.userId);
    const { roleId } = req.body ?? {};
    if (!roleId) throw new ValidationError('roleId is required');
    const role = await prisma.role.findUnique({ where: { id: String(roleId) } });
    if (!role || !role.isActive) throw new NotFoundError('Active role');
    const { actorId, tenantId } = await assertMayAssign(req, targetUserId, role);
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: targetUserId } });
      await tx.userRole.create({ data: { userId: targetUserId, roleId: role.id, assignedBy: actorId } });
    });
    await clearPermissionCache(targetUserId, tenantId);
    res.json({ message: 'Role assigned successfully.' });
  } catch (error) {
    if (error?.code === 'P2002') return next(new ConflictError('This user already has that role'));
    next(error);
  }
}

export async function revokeUserRole(req, res, next) {
  try {
    const { userId, roleId } = req.body ?? {};
    if (!userId || !roleId) throw new ValidationError('userId and roleId are required');
    const role = await prisma.role.findUnique({ where: { id: String(roleId) } });
    if (!role) throw new NotFoundError('Role');
    const { tenantId } = await assertMayAssign(req, userId, role);
    await prisma.userRole.deleteMany({ where: { userId: String(userId), roleId: role.id } });
    await clearPermissionCache(String(userId), tenantId);
    res.json({ message: 'Role revoked' });
  } catch (error) { next(error); }
}

export async function getUserRoles(req, res, next) {
  try {
    const { id: actorId, tenantId } = actor(req);
    const targetId = String(req.params.userId);
    const canReadOthers = isPlatformAdmin(req) || await canManageRoles(req);
    if (targetId !== actorId && !canReadOthers) throw new ForbiddenError('Only administrators may view another user’s roles');
    if (!tenantId) throw new ValidationError('An organization is required for IACMS role assignments');
    const userRoles = await prisma.userRole.findMany({
      where: {
        userId: targetId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        role: { isActive: true, OR: [{ tenantId }, { tenantId: null }] },
      },
      include: { role: { include: roleInclude } },
    });
    res.json({ userRoles });
  } catch (error) { next(error); }
}

export async function checkUserPermission(req, res, next) {
  try {
    const { userId, resource, action, permission } = req.body ?? {};
    const [resourceName, actionName] = typeof permission === 'string' ? permission.split(':', 2) : [];
    const requestedResource = resource || resourceName;
    const requestedAction = action || actionName;
    if (!userId || !requestedResource || !requestedAction) throw new ValidationError('userId and resource/action or permission are required');
    const { id: actorId, tenantId } = actor(req);
    if (String(userId) !== actorId && !isPlatformAdmin(req) && !await canManageRoles(req)) {
      throw new ForbiddenError('Only administrators may check another user’s permissions');
    }
    if (tenantId) {
      const target = await prisma.identityProjection.findUnique({
        where: { subjectId_tenantId: { subjectId: String(userId), tenantId } },
        select: { subjectId: true, isActive: true, deletedAt: true },
      });
      if (!target) throw new NotFoundError('Organization identity');
      if (!target.isActive || target.deletedAt) {
        return res.json({ hasPermission: false, userId, permission: `${requestedResource}:${requestedAction}` });
      }
    }
    const allowed = await prisma.userRole.findFirst({
      where: {
        userId: String(userId),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        role: {
          isActive: true,
          OR: tenantId ? [{ tenantId }, { tenantId: null }] : [{ tenantId: null }],
          rolePermissions: { some: { permission: { resource: requestedResource, action: requestedAction } } },
        },
      },
      select: { id: true },
    });
    res.json({ hasPermission: Boolean(allowed), userId, permission: `${requestedResource}:${requestedAction}` });
  } catch (error) { next(error); }
}
