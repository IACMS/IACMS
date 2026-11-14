import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findUserForOAuthClient,
  resolveActiveClientMembership,
  resolveClientOrganization,
} from '../../src/oauth/organization-access.js';

afterEach(() => {
  delete process.env.IAM_ORG_MEMBERSHIPS_ENABLED;
  delete process.env.IAM_LEGACY_ORGANIZATION_SYSTEM;
});

describe('OAuth organization membership resolution', () => {
  it('maps a legacy tenant-scoped client to its IAM organization when enabled', async () => {
    process.env.IAM_ORG_MEMBERSHIPS_ENABLED = 'true';
    const organization = { id: 'org-1', isActive: true };
    const db = { iamOrganization: { findUnique: vi.fn().mockResolvedValue(organization) } };

    await expect(resolveClientOrganization(db, { [Symbol.for('tenant_id')]: 'tenant-1' }))
      .resolves.toEqual({ required: true, organization, tenantId: 'tenant-1' });

    expect(db.iamOrganization.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { externalSystem_externalId: { externalSystem: 'iacms', externalId: 'tenant-1' } },
    }));
  });

  it('resolves login identities only through an active organization membership', async () => {
    const organization = { id: 'org-1', isActive: true };
    const user = { id: 'subject-1', email: 'alex@example.org', isActive: true };
    const db = {
      iamOrganization: { findUnique: vi.fn().mockResolvedValue(organization) },
      iamMembership: { findMany: vi.fn().mockResolvedValue([{ subjectId: user.id }]) },
      user: { findUnique: vi.fn().mockResolvedValue(user) },
    };

    await expect(findUserForOAuthClient(db, user.email, { iamOrganizationId: organization.id }))
      .resolves.toBe(user);
    expect(db.iamMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: organization.id, status: 'active', subject: { is: { email: user.email, isActive: true } } },
      take: 2,
    }));
  });

  it('rejects ambiguous identities when duplicate emails are members of one organization', async () => {
    const db = {
      iamOrganization: { findUnique: vi.fn().mockResolvedValue({ id: 'org-1', isActive: true }) },
      iamMembership: { findMany: vi.fn().mockResolvedValue([{ subjectId: 'subject-1' }, { subjectId: 'subject-2' }]) },
      user: { findUnique: vi.fn() },
    };

    await expect(findUserForOAuthClient(db, 'alex@example.org', { iamOrganizationId: 'org-1' }))
      .resolves.toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects disabled organizations and inactive memberships', async () => {
    const db = {
      iamOrganization: { findUnique: vi.fn().mockResolvedValue({ id: 'org-1', isActive: true }) },
      iamMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'm-1', status: 'suspended' }) },
    };

    await expect(resolveActiveClientMembership(db, 'subject-1', { iamOrganizationId: 'org-1' }))
      .resolves.toEqual(expect.objectContaining({ required: true, allowed: false }));
  });
});
