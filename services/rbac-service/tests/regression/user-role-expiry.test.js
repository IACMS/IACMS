/**
 * Regression — expired UserRole rows must not grant permissions (gateway RBAC contract).
 */
import { describe, it, expect, vi } from 'vitest';

const { userRoleFindMany } = vi.hoisted(() => ({
  userRoleFindMany: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: { userRole: { findMany: userRoleFindMany } },
}));

import { getUserPermissions } from '../../src/controllers/permission.controller.js';

describe('UserRole expiry regression', () => {
  it('getUserPermissions query excludes expired role assignments', async () => {
    userRoleFindMany.mockResolvedValue([]);
    const res = { json: vi.fn() };
    await getUserPermissions({ params: { userId: 'u1' } }, res, vi.fn());

    expect(userRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    );
  });
});
