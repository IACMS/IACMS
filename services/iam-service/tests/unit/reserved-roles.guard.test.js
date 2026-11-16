import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    role: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    userRole: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((ops) => Promise.all(ops)),
  },
}));

vi.mock('../../src/config/database.js', () => ({
  default: mockPrisma,
}));

vi.mock('../../src/utils/audit.helpers.js', () => ({
  withAuditClient: vi.fn((data) => data),
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  getEventBus: vi.fn(() => null),
  TOPICS: { USER_UPDATED: 'user.updated' },
}));

import { createRole } from '../../src/controllers/role.controller.js';
import { assignRole as assignUserRole } from '../../src/controllers/user-role.controller.js';
import { assignRole as adminAssignUserRole } from '../../src/controllers/auth/admin.users.controller.js';

describe('Reserved roles system-admin, iam-admin and system_admin assignment guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('user-role.controller: forbids non-system admin from assigning role with slug iam-admin', async () => {
    const req = {
      headers: {
        'x-tenant-id': 'tenant-1',
        'x-user-roles': 'role-tenant-admin',
        'x-user-id': 'user-caller',
      },
      body: {
        userId: 'target-user',
        roleId: 'role-iam-admin-id',
      },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    // Caller has tenant_admin role, NOT system_admin
    mockPrisma.role.findMany.mockResolvedValueOnce([
      { id: 'role-tenant-admin', name: 'tenant_admin', slug: 'tenant-admin', isActive: true },
    ]);
    mockPrisma.role.findUnique.mockResolvedValueOnce({
      id: 'role-iam-admin-id',
      name: 'IAM Administrator',
      slug: 'iam-admin', // Reserved slug!
      isActive: true,
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'target-user',
      tenantId: 'tenant-1',
    });

    await assignUserRole(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });

  it('admin.users.controller: forbids non-system admin from assigning role with slug iam-admin', async () => {
    const req = {
      user: {
        id: 'caller-id',
        tenantId: 'tenant-1',
        roles: ['role-tenant-admin'],
      },
      params: { id: 'target-user-id' },
      body: { roleId: 'role-iam-admin-id' },
    };
    const res = { json: vi.fn() };
    const next = vi.fn();

    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: 'target-user-id',
      tenantId: 'tenant-1',
    });
    // Target role has reserved slug 'iam-admin'
    mockPrisma.role.findFirst.mockResolvedValueOnce({
      id: 'role-iam-admin-id',
      name: 'IAM Administrator',
      slug: 'iam-admin',
      tenantId: null,
    });
    // Caller only has tenant_admin
    mockPrisma.role.findMany.mockResolvedValueOnce([
      { id: 'role-tenant-admin', name: 'tenant_admin', slug: 'tenant-admin' },
    ]);

    await adminAssignUserRole(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });
});
