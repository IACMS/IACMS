import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';

export async function getRoles(req, res, next) {
  try {
    const { tenantId } = req.query;
    const roles = await prisma.role.findMany({
      where: tenantId ? { tenantId } : {},
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
    const role = await prisma.role.create({
      data: req.body,
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
    const role = await prisma.role.update({
      where: { id: req.params.id },
      data: req.body,
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

