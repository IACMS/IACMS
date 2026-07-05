/**
 * Regression — system_admin must NOT receive tenant-wide case access via caseAccessPolicy.
 */
import { describe, it, expect, vi } from 'vitest';

const { userRoleFindMany } = vi.hoisted(() => ({
  userRoleFindMany: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: { userRole: { findMany: userRoleFindMany } },
}));

import { userHasTenantWideCaseAccess } from '../../src/security/caseAccessPolicy.js';

describe('system_admin case visibility regression', () => {
  it('only checks tenant_admin role name, not system_admin', async () => {
    userRoleFindMany.mockResolvedValue([]);
    const prisma = { userRole: { findMany: userRoleFindMany } };
    await userHasTenantWideCaseAccess(prisma, 'platform-admin');

    const where = userRoleFindMany.mock.calls[0][0].where;
    expect(where.role.name).toBe('tenant_admin');
    expect(where.role.name).not.toBe('system_admin');
  });
});
