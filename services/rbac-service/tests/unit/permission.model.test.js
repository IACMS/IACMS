/**
 * Unit tests — Permission resolution for UserRole + RolePermission models.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { userRoleFindMany } = vi.hoisted(() => ({
  userRoleFindMany: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: { userRole: { findMany: userRoleFindMany } },
}));

import { getUserPermissions, checkPermission } from '../../src/controllers/permission.controller.js';

const activePermission = {
  id: 'p1',
  resource: 'cases',
  action: 'read',
  description: 'View cases',
};

const activeRoleAssignment = {
  role: {
    id: 'r-active',
    name: 'case_manager',
    isSystemRole: false,
    isActive: true,
    rolePermissions: [{ permission: activePermission }],
  },
};

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('Permission + UserRole models — getUserPermissions', () => {
  beforeEach(() => {
    userRoleFindMany.mockReset();
  });

  it('deduplicates permissions across multiple roles', async () => {
    userRoleFindMany.mockResolvedValue([activeRoleAssignment, activeRoleAssignment]);
    const res = mockRes();
    await getUserPermissions({ params: { userId: 'u1' } }, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        permissions: ['cases:read'],
        roleIds: ['r-active'],
      }),
    );
  });

  it('skips inactive roles when resolving permissions', async () => {
    userRoleFindMany.mockResolvedValue([
      {
        role: {
          id: 'r-off',
          name: 'disabled',
          isActive: false,
          rolePermissions: [{ permission: activePermission }],
        },
      },
      activeRoleAssignment,
    ]);
    const res = mockRes();
    await getUserPermissions({ params: { userId: 'u1' } }, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.permissions).toEqual(['cases:read']);
  });
});

describe('Permission model — checkPermission', () => {
  it('returns 400 when resource or action is missing', async () => {
    const res = mockRes();
    await checkPermission({ params: { userId: 'u1' }, query: {} }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
