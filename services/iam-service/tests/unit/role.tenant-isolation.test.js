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
  },
}));

import prisma from '../../src/config/database.js';
import { getRoles, createRole } from '../../src/controllers/role.controller.js';

describe('Item 2: Role Controller Tenant Isolation & Scoping', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
      query: {},
      user: { id: 'u-tenant-admin', tenantId: 'tenant-caller' },
      body: {},
      params: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('getRoles tenant scoping', () => {
    it('forces caller tenant and ignores query tenantId when requested by non-platform admin', async () => {
      req.query.tenantId = 'other-tenant-attempt';
      prisma.role.findMany.mockResolvedValue([]);

      await getRoles(req, res, next);

      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ tenantId: null }, { tenantId: 'tenant-caller' }],
          }),
        })
      );
      // Ensure 'other-tenant-attempt' was NOT used in where
      const callArg = prisma.role.findMany.mock.calls[0][0];
      expect(JSON.stringify(callArg)).not.toContain('other-tenant-attempt');
    });

    it('scopes query to caller tenant even when no tenantId query param is provided', async () => {
      prisma.role.findMany.mockResolvedValue([]);

      await getRoles(req, res, next);

      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ tenantId: null }, { tenantId: 'tenant-caller' }],
          }),
        })
      );
    });
  });

  describe('createRole tenant and systemRole enforcement', () => {
    it('ignores body tenantId and isSystemRole for non-platform admin and forces caller tenant', async () => {
      req.body = {
        name: 'Finance Manager',
        tenantId: 'rogue-tenant-id',
        isSystemRole: true,
      };
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.role.create.mockImplementation(async ({ data }) => ({ id: 'r-1', ...data }));

      await createRole(req, res, next);

      expect(prisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Finance Manager',
            tenantId: 'tenant-caller',
            isSystemRole: false,
          }),
        })
      );
    });
  });
});
