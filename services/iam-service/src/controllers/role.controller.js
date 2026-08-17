import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';

export async function getRoles(req, res, next) {
  try {
    const { tenantId } = req.query;
    /** Global roles (`tenant_id` null) plus the requesting tenant’s scoped roles. */
    const where =
      tenantId && String(tenantId).length > 0
        ? { OR: [{ tenantId: null }, { tenantId: String(tenantId) }] }
        : {};
    const roles = await prisma.role.findMany({
      where,
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });
    res.json({ roles });
  } catch (error) {
    next(error);
  }
}

export async function getRole(req, res, next) {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });
    if (!role) throw new NotFoundError('Role');
    res.json({ role });
  } catch (error) {
    next(error);
  }
}

export async function createRole(req, res, next) {
  try {
    const { name, description, tenantId, isSystemRole, permissionIds } = req.body;
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Role name is required');
    }

    const roleData = {
      name,
      description: description || null,
      tenantId: tenantId || null,
      isSystemRole: Boolean(isSystemRole),
    };

    if (Array.isArray(permissionIds) && permissionIds.length > 0) {
      roleData.rolePermissions = {
        create: permissionIds.map((permissionId) => ({ permissionId })),
      };
    }

    const role = await prisma.role.create({
      data: roleData,
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });
    res.status(201).json({ role });
  } catch (error) {
    next(error);
  }
}

export async function updateRole(req, res, next) {
  try {
    const roleId = req.params.id;
    const { name, description, permissionIds } = req.body;

    const existingRole = await prisma.role.findUnique({ where: { id: roleId } });
    if (!existingRole) throw new NotFoundError('Role');

    if (Array.isArray(permissionIds)) {
      await prisma.rolePermission.deleteMany({
        where: { roleId },
      });

      if (permissionIds.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId,
            permissionId,
          })),
        });
      }
    }

    const role = await prisma.role.update({
      where: { id: roleId },
      data: {
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });

    res.json({ role });
  } catch (error) {
    next(error);
  }
}

export async function deleteRole(req, res, next) {
  try {
    await prisma.role.delete({ where: { id: req.params.id } });
    res.json({ message: 'Role deleted' });
  } catch (error) {
    next(error);
  }
}
