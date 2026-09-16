import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      role: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      userRole: {
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
    },
  };
});

vi.mock('../../../../shared/utils/userRoles.js', () => ({
  loadUserRoleIdsForUser: vi.fn().mockResolvedValue([]),
}));

import prisma from '../../src/config/database.js';
import { assignRole, revokeRole } from '../../src/controllers/user-role.controller.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../shared/common/errors.js';

describe('User Role Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: { 'x-tenant-id': 't-1', 'x-user-id': 'u-1', 'x-user-roles': 'role-admin' },
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('assignRole', () => {
    it('assigns a role successfully', async () => {
      req.body = { userId: 'u-2', roleId: 'role-1' };
      prisma.role.findMany.mockResolvedValue([{ id: 'role-admin', name: 'tenant_admin' }]);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'user' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u-2', tenantId: 't-1' });
      prisma.userRole.create.mockResolvedValue({ userId: 'u-2', roleId: 'role-1' });

      await assignRole(req, res, next);

      expect(prisma.userRole.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ userRole: expect.any(Object) });
    });

    it('throws ValidationError if missing parameters', async () => {
      await assignRole(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('throws ForbiddenError if actor is not an admin', async () => {
      req.body = { userId: 'u-2', roleId: 'role-1' };
      prisma.role.findMany.mockResolvedValue([{ id: 'role-normal', name: 'user' }]);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'user' });

      await assignRole(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });
  });

  describe('revokeRole', () => {
    it('revokes a role successfully', async () => {
      req.body = { userId: 'u-2', roleId: 'role-1' };
      prisma.role.findMany.mockResolvedValue([{ id: 'role-admin', name: 'tenant_admin' }]);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'user' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u-2', tenantId: 't-1' });

      await revokeRole(req, res, next);

      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-2', roleId: 'role-1' } });
      expect(res.json).toHaveBeenCalledWith({ message: 'Role revoked' });
    });
  });
});
