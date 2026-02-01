import prisma from '../config/database.js';
import { NotFoundError } from '../../../../shared/common/errors.js';

/**
 * Get all permissions
 */
export async function getPermissions(req, res, next) {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
    res.json({ permissions });
  } catch (error) {
    next(error);
  }
}

/**
 * Get permission by ID
 */
export async function getPermission(req, res, next) {
  try {
    const permission = await prisma.permission.findUnique({
      where: { id: req.params.id },
    });
    if (!permission) throw new NotFoundError('Permission');
    res.json({ permission });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all permissions for a specific user
 * This endpoint is used by the API Gateway for RBAC checks
 */
export async function getUserPermissions(req, res, next) {
  try {
    const { userId } = req.params;

    // Get all roles assigned to the user
    const userRoles = await prisma.userRole.findMany({
      where: {
        userId,
        // Only include non-expired roles
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    // Extract unique permissions from all roles
    const permissionSet = new Set();
    const permissionDetails = [];

    for (const userRole of userRoles) {
      const role = userRole.role;
      
      // Skip inactive roles
      if (!role.isActive) continue;

      for (const rolePermission of role.rolePermissions) {
        const permission = rolePermission.permission;
        const permKey = `${permission.resource}:${permission.action}`;
        
        if (!permissionSet.has(permKey)) {
          permissionSet.add(permKey);
          permissionDetails.push({
            id: permission.id,
            resource: permission.resource,
            action: permission.action,
            description: permission.description,
          });
        }
      }
    }

    // Return permissions as an array of "resource:action" strings
    const permissions = Array.from(permissionSet);

    res.json({
      userId,
      permissions,
      details: permissionDetails,
      roles: userRoles.map(ur => ({
        id: ur.role.id,
        name: ur.role.name,
        isSystemRole: ur.role.isSystemRole,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Check if a user has a specific permission
 */
export async function checkPermission(req, res, next) {
  try {
    const { userId } = req.params;
    const { resource, action } = req.query;

    if (!resource || !action) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Resource and action are required',
        },
      });
    }

    // Get all roles assigned to the user
    const userRoles = await prisma.userRole.findMany({
      where: {
        userId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: {
                  where: {
                    resource,
                    action,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Check if any role has the required permission
    const hasPermission = userRoles.some(userRole => {
      if (!userRole.role.isActive) return false;
      return userRole.role.rolePermissions.some(rp => 
        rp.permission && 
        rp.permission.resource === resource && 
        rp.permission.action === action
      );
    });

    res.json({
      userId,
      permission: `${resource}:${action}`,
      allowed: hasPermission,
    });
  } catch (error) {
    next(error);
  }
}

