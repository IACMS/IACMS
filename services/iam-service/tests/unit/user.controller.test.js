import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    userRole: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  getEventBus: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../../src/utils/globalTenantAdminRole.js', () => ({
  allGlobalTenantAdminRoleIds: vi.fn().mockResolvedValue(['r-admin']),
}));

import prisma from '../../src/config/database.js';
import { listUsers, deactivateUser, reactivateUser, deleteUser, assignRole } from '../../src/controllers/auth/admin.users.controller.js';

describe('admin.users.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      user: { id: 'admin-123', tenantId: 'tenant-001', roles: ['role-admin'] },
      params: {},
      body: {},
      query: {},
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
    prisma.userRole.findMany.mockResolvedValue([]);
    prisma.userRole.findFirst.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(1);
  });

  describe('listUsers', () => {
    it('returns formatted user list with pagination for requesting tenant', async () => {
      prisma.user.count.mockResolvedValueOnce(1);
      prisma.user.findMany.mockResolvedValueOnce([
        {
          id: 'u-1',
          email: 'user1@tenant.org',
          firstName: 'Worku',
          lastName: 'Mamo',
          departmentId: null,
          department: null,
          isActive: true,
          lastLogin: null,
          createdAt: new Date('2026-08-01'),
          userRoles: [{ role: { id: 'r-1', name: 'case_worker' } }],
        },
      ]);

      await listUsers(req, res, next);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-001' },
          take: 50,
          skip: 0,
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        users: [
          expect.objectContaining({
            id: 'u-1',
            email: 'user1@tenant.org',
            firstName: 'Worku',
            role: { id: 'r-1', name: 'case_worker' },
          }),
        ],
        pagination: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
        },
      });
    });
  });

  describe('assignRole', () => {
    it('fetches priorRole before transaction and assigns role', async () => {
      req.params = { id: 'u-2' };
      req.body = { roleId: 'role-new' };
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'u-2', tenantId: 'tenant-001' });
      prisma.role.findFirst.mockResolvedValueOnce({ id: 'role-new', name: 'analyst', tenantId: 'tenant-001' });
      prisma.userRole.findFirst.mockResolvedValueOnce({ userId: 'u-2', roleId: 'role-old' });

      await assignRole(req, res, next);

      expect(prisma.userRole.findFirst).toHaveBeenCalledWith({ where: { userId: 'u-2' } });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: 'Role assigned successfully.' });
    });
  });

  describe('deactivateUser', () => {
    it('prevents self-deactivation by admin', async () => {
      req.params = { id: 'admin-123' };

      await deactivateUser(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'You cannot deactivate your own account' })
      );
    });

    it('deactivates target user when valid', async () => {
      req.params = { id: 'u-2' };
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'u-2', tenantId: 'tenant-001', isActive: true });
      prisma.user.update.mockResolvedValueOnce({ id: 'u-2', isActive: false });

      await deactivateUser(req, res, next);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u-2' }, data: { isActive: false } });
      expect(res.json).toHaveBeenCalledWith({ message: 'User deactivated.' });
    });
  });

  describe('reactivateUser', () => {
    it('reactivates user', async () => {
      req.params = { id: 'u-2' };
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'u-2', tenantId: 'tenant-001', isActive: false });
      prisma.user.update.mockResolvedValueOnce({ id: 'u-2', isActive: true });

      await reactivateUser(req, res, next);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u-2' }, data: { isActive: true } });
      expect(res.json).toHaveBeenCalledWith({ message: 'User reactivated.' });
    });
  });

  describe('deleteUser', () => {
    it('prevents self-deletion by admin', async () => {
      req.params = { id: 'admin-123' };

      await deleteUser(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'You cannot delete your own account' })
      );
    });
  });
});
