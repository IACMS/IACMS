import prisma from '../config/database.js';
import { ValidationError, NotFoundError } from '../../../../shared/common/errors.js';

export async function assignRole(req, res, next) {
  try {
    const { userId, roleId, assignedBy, expiresAt } = req.body;
    if (!userId || !roleId) {
      throw new ValidationError('userId and roleId are required');
    }
    const userRole = await prisma.userRole.create({
      data: { userId, roleId, assignedBy, expiresAt },
      include: { role: true },
    });
    res.status(201).json({ userRole });
  } catch (error) {
    next(error);
  }
}

export async function revokeRole(req, res, next) {
  try {
    const { userId, roleId } = req.body;
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
    const { userId, resource, action } = req.body;
    // Implementation for permission check
    res.json({ hasPermission: false }); // Placeholder
  } catch (error) {
    next(error);
  }
}

