import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/config/database.js', () => ({
  default: mockPrisma,
}));

import { findAccount } from '../../src/oauth/find-account.js';

describe('findAccount unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined if user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    const account = await findAccount({}, 'non-existent-user');
    expect(account).toBeUndefined();
  });

  it('returns undefined if user is inactive', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      isActive: false,
      tenant: { isActive: true, code: 'T1' },
    });
    const account = await findAccount({}, 'u-1');
    expect(account).toBeUndefined();
  });

  it('returns undefined if tenant is inactive', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      isActive: true,
      tenant: { isActive: false, code: 'T1' },
    });
    const account = await findAccount({}, 'u-1');
    expect(account).toBeUndefined();
  });

  it('returns account with claims builder when user and tenant are active', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-100',
      email: 'alex@iacms.org',
      firstName: 'Alex',
      lastName: 'Smith',
      isActive: true,
      isEmailVerified: true,
      tenantId: 'tenant-uuid-1',
      departmentId: 'dept-uuid-2',
      tenant: { code: 'TENANT1', isActive: true },
      userRoles: [{ roleId: 'role-admin-uuid' }, { roleId: 'role-editor-uuid' }],
    });

    const account = await findAccount({}, 'u-100');
    expect(account).toBeDefined();
    expect(account.accountId).toBe('u-100');

    // Base claims
    const baseClaims = await account.claims('id_token', '');
    expect(baseClaims).toEqual({
      sub: 'u-100',
      tenant_id: 'tenant-uuid-1',
      tenant_code: 'TENANT1',
    });

    // Profile + email + roles
    const fullClaims = await account.claims('id_token', 'openid profile email roles');
    expect(fullClaims).toEqual({
      sub: 'u-100',
      tenant_id: 'tenant-uuid-1',
      tenant_code: 'TENANT1',
      given_name: 'Alex',
      family_name: 'Smith',
      name: 'Alex Smith',
      email: 'alex@iacms.org',
      email_verified: true,
      roles: ['role-admin-uuid', 'role-editor-uuid'],
      department_id: 'dept-uuid-2',
    });
  });
});
