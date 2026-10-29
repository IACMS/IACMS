import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      role: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      permission: {
        findMany: vi.fn(),
      },
      rolePermission: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (arg) => {
        if (Array.isArray(arg)) {
          return await Promise.all(arg);
        }
        if (typeof arg === 'function') {
          return await arg({
            role: {
              update: vi.fn(),
              delete: vi.fn(),
            },
            rolePermission: {
              deleteMany: vi.fn(),
              createMany: vi.fn(),
            },
          });
        }
        return arg;
      }),
    },
  };
});

import prisma from '../../src/config/database.js';
import { getRoles, getRole, createRole, updateRole, deleteRole } from '../../src/controllers/role.controller.js';
import { ValidationError, NotFoundError } from '../../../../shared/common/errors.js';

describe('Role Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
      query: {},
      user: { tenantId: 't-1' },
      params: {},
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('getRoles', () => {
    it('returns roles considering tenant isolation', async () => {
      req.query.tenantId = 't-1';
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1' }]);

      await getRoles(req, res, next);

      expect(prisma.role.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ tenantId: null }, { tenantId: 't-1' }],
        }),
      }));
      expect(res.json).toHaveBeenCalledWith({ roles: [{ id: 'role-1' }] });
    });

    it('allows platform admins to see all non-tenant specific roles', async () => {
      req.headers['x-user-permissions'] = 'platform:manage_tenants';
      prisma.role.findMany.mockResolvedValue([{ id: '1', name: 'PlatformAdmin', tenantId: null }]);

      await getRoles(req, res, next);

      expect(prisma.role.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {},
      }));
      expect(res.json).toHaveBeenCalledWith({ roles: expect.any(Array) });
    });
  });

  describe('getRole', () => {
    it('returns a role by id when matching caller tenant', async () => {
      req.params.id = 'role-1';
      req.user = { tenantId: 'tenant-1' };
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', tenantId: 'tenant-1' });

      await getRole(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ role: { id: 'role-1', tenantId: 'tenant-1' } });
    });

    it('returns platform-level role (tenantId: null) to tenant user', async () => {
      req.params.id = 'role-1';
      req.user = { tenantId: 'tenant-1' };
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', tenantId: null });

      await getRole(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ role: { id: 'role-1', tenantId: null } });
    });

    it('throws NotFoundError if role belongs to another tenant', async () => {
      req.params.id = 'role-1';
      req.user = { tenantId: 'tenant-1' };
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', tenantId: 'other-tenant' });

      await getRole(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });

    it('throws NotFoundError if not found', async () => {
      req.params.id = 'role-1';
      prisma.role.findUnique.mockResolvedValue(null);

      await getRole(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });
  });

  describe('createRole', () => {
    it('creates a role', async () => {
      req.body = { name: 'Admin', permissionIds: ['p-1'] };
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-1', resource: 'cases' }]);
      prisma.role.create.mockResolvedValue({ id: 'role-1', name: 'Admin' });

      await createRole(req, res, next);

      expect(prisma.role.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'Admin',
        }),
      }));
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ role: expect.any(Object) });
    });

    it('throws error if regular user assigns platform permissions', async () => {
      req.body = { name: 'Admin', permissionIds: ['p-1'] };
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-1', resource: 'platform' }]);

      await createRole(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('updateRole', () => {
    it('updates a role and its permissions within a transaction', async () => {
      req.params.id = 'role-1';
      req.body = { name: 'SuperAdmin', permissionIds: ['p-2'] };

      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', isSystemRole: false, rolePermissions: [] });
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-2', resource: 'cases' }]);
      prisma.rolePermission.deleteMany.mockResolvedValue({ count: 1 });
      prisma.rolePermission.createMany.mockResolvedValue({ count: 1 });
      prisma.role.update.mockResolvedValue({ id: 'role-1', name: 'SuperAdmin' });

      await updateRole(req, res, next);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.role.update).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('deleteRole', () => {
    it('deletes a role', async () => {
      req.params.id = 'role-1';
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', isSystemRole: false, rolePermissions: [] });

      await deleteRole(req, res, next);
      expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
      expect(res.json).toHaveBeenCalledWith({ message: 'Role deleted' });
    });
  });
});
