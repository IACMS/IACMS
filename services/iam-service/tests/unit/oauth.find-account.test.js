import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
    iamOrganization: { findUnique: vi.fn() },
    iamMembership: { findUnique: vi.fn() },
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
    });
  });

  it('uses an active IAM organization membership for organization-scoped OAuth clients', async () => {
    const client = { [Symbol.for('iam_organization_id')]: 'org-1' };
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-200',
      email: 'member@example.org',
      firstName: 'Sam',
      lastName: 'Member',
      isActive: true,
      isEmailVerified: true,
      tenantId: 'legacy-tenant',
      departmentId: 'legacy-department',
      tenant: { code: 'LEGACY', isActive: false },
      userRoles: [{ roleId: 'iacms-domain-role' }],
    });
    mockPrisma.iamOrganization.findUnique.mockResolvedValue({
      id: 'org-1', name: 'Project Org', slug: 'project-org', isActive: true,
      externalSystem: 'project-x', externalId: 'org-ref-1',
    });
    mockPrisma.iamMembership.findUnique.mockResolvedValue({
      id: 'membership-1', subjectId: 'u-200', organizationId: 'org-1', status: 'active',
    });

    const account = await findAccount({ oidc: { client } }, 'u-200');

    expect(account?.accountId).toBe('u-200');
    await expect(account.claims('id_token', 'openid profile')).resolves.toEqual({
      sub: 'u-200',
      organization_id: 'org-1',
      given_name: 'Sam',
      family_name: 'Member',
      name: 'Sam Member',
      organization_name: 'Project Org',
    });
    await expect(account.claims('access_token', 'roles')).resolves.toEqual({
      sub: 'u-200',
      organization_id: 'org-1',
      roles: [],
    });
  });

  it('authenticates a tenantless global identity through its active organization membership', async () => {
    const client = { iamOrganizationId: 'org-global' };
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-global', email: 'global@example.org', firstName: 'Global', lastName: 'User',
      isActive: true, isEmailVerified: true, tenantId: null, departmentId: null,
      tenant: null, userRoles: [],
    });
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce({
      id: 'org-global', name: 'External Project', slug: 'external-project', isActive: true,
      externalSystem: 'external', externalId: 'project-org-1',
    });
    mockPrisma.iamMembership.findUnique.mockResolvedValueOnce({
      id: 'membership-global', subjectId: 'u-global', organizationId: 'org-global', status: 'active',
    });

    const account = await findAccount({ oidc: { client } }, 'u-global');
    expect(account?.accountId).toBe('u-global');
    await expect(account.claims('id_token', 'openid profile email')).resolves.toEqual({
      sub: 'u-global', organization_id: 'org-global', given_name: 'Global', family_name: 'User',
      name: 'Global User', organization_name: 'External Project',
      email: 'global@example.org', email_verified: true,
    });
  });

  it('rejects organization-scoped accounts without an active membership', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-201', isActive: true, tenant: { code: 'LEGACY', isActive: true },
    });
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce({
      id: 'org-2', name: 'Project Org', isActive: true,
    });
    mockPrisma.iamMembership.findUnique.mockResolvedValueOnce(null);

    await expect(findAccount({ oidc: { client: { iamOrganizationId: 'org-2' } } }, 'u-201'))
      .resolves.toBeUndefined();
  });
});
