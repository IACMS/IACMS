import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
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
  },
}));

import prisma from '../../src/config/database.js';
import { getRoles, createRole, updateRole, deleteRole } from '../../src/controllers/role.controller.js';

describe('role.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      query: {},
      params: {},
      body: {},
      headers: {},
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('getRoles', () => {
    it('returns filtered roles hiding platform roles for regular users', async () => {
      req.query = { tenantId: 't-1' };
      req.headers['x-user-permissions'] = 'cases:read,users:read';
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'r-1', name: 'tenant_user' }]);

      await getRoles(req, res, next);

      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ tenantId: null }, { tenantId: 't-1' }],
            rolePermissions: { none: { permission: { resource: 'platform' } } },
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({ roles: [{ id: 'r-1', name: 'tenant_user' }] });
    });
  });

  describe('createRole', () => {
    it('throws ValidationError if role name is missing', async () => {
      req.body = { description: 'No name provided' };

      await createRole(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Role name is required' }));
    });

    it('blocks regular users from granting platform permissions', async () => {
      req.body = { name: 'SuperAdmin', permissionIds: ['p-platform'] };
      req.headers['x-user-permissions'] = 'users:create';
      prisma.permission.findMany.mockResolvedValueOnce([{ id: 'p-platform', resource: 'platform' }]);

      await createRole(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Only platform administrators can create roles with platform permissions.' })
      );
    });

    it('allows platform admins to create roles with platform permissions', async () => {
      req.body = { name: 'PlatformManager', permissionIds: ['p-platform'] };
      req.headers['x-user-permissions'] = 'platform:manage_tenants';
      prisma.role.create.mockResolvedValueOnce({ id: 'r-new', name: 'PlatformManager' });

      await createRole(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ role: { id: 'r-new', name: 'PlatformManager' } });
    });
  });

  describe('updateRole', () => {
    it('blocks non-platform-admins from updating roles with platform permissions', async () => {
      req.params = { id: 'r-platform' };
      req.body = { name: 'UpdatedName' };
      req.headers['x-user-permissions'] = 'users:update';
      prisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-platform',
        rolePermissions: [{ permission: { resource: 'platform' } }],
      });

      await updateRole(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Only platform administrators can edit platform admin roles.' })
      );
    });
  });

  describe('deleteRole', () => {
    it('blocks non-platform-admins from deleting platform roles', async () => {
      req.params = { id: 'r-platform' };
      req.headers['x-user-permissions'] = 'users:delete';
      prisma.role.findUnique.mockResolvedValueOnce({
        id: 'r-platform',
        rolePermissions: [{ permission: { resource: 'platform' } }],
      });

      await deleteRole(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Only platform administrators can delete platform admin roles.' })
      );
    });
  });
});
