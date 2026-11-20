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
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return await callback({
          role: {
            update: vi.fn(),
            delete: vi.fn(),
          },
          rolePermission: {
            deleteMany: vi.fn(),
            createMany: vi.fn(),
          },
        });
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
      body: {},
      params: {},
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
          OR: [{ tenantId: null }, { tenantId: 't-1' }]
        })
      }));
      expect(res.json).toHaveBeenCalledWith({ roles: [{ id: 'role-1' }] });
    });

    it('allows platform admins to see all non-tenant specific roles', async () => {
      req.headers['x-user-permissions'] = 'platform:manage_tenants';
      await getRoles(req, res, next);
      
      expect(prisma.role.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {} // no restrictions on platform resource
      }));
    });
  });

  describe('getRole', () => {
    it('returns a role by id', async () => {
      req.params.id = 'role-1';
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });

      await getRole(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ role: { id: 'role-1' } });
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
          rolePermissions: { create: [{ permissionId: 'p-1' }] }
        })
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
    it('updates a role and its permissions', async () => {
      req.params.id = 'role-1';
      req.body = { name: 'SuperAdmin', permissionIds: ['p-2'] };
      
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', isSystemRole: false, rolePermissions: [] });
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-2', resource: 'cases' }]);
      prisma.role.update.mockResolvedValue({ id: 'role-1', name: 'SuperAdmin' });
      await updateRole(req, res, next);
      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-1' } });
      expect(prisma.rolePermission.createMany).toHaveBeenCalled();
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
