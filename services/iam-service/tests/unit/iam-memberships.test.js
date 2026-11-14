import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncLegacyTenantMembership } from '../../src/iamMemberships.js';

afterEach(() => {
  delete process.env.IAM_ORG_MEMBERSHIPS_ENABLED;
  delete process.env.IAM_LEGACY_ORGANIZATION_SYSTEM;
});

describe('syncLegacyTenantMembership', () => {
  it('is inert until the membership bridge is enabled', async () => {
    const db = {
      iamOrganization: { upsert: vi.fn() },
      iamMembership: { upsert: vi.fn() },
    };

    await expect(syncLegacyTenantMembership(db, {
      tenant: { id: 't-1', name: 'Agency', code: 'AGENCY', isActive: true },
      user: { id: 'u-1', isActive: true },
    })).resolves.toBeNull();

    expect(db.iamOrganization.upsert).not.toHaveBeenCalled();
    expect(db.iamMembership.upsert).not.toHaveBeenCalled();
  });

  it('maps the legacy tenant and identity to an active generic membership', async () => {
    process.env.IAM_ORG_MEMBERSHIPS_ENABLED = 'true';
    process.env.IAM_LEGACY_ORGANIZATION_SYSTEM = 'iacms-test';
    const organization = { id: 'org-1' };
    const membership = { id: 'membership-1' };
    const db = {
      iamOrganization: { upsert: vi.fn().mockResolvedValue(organization) },
      iamMembership: { upsert: vi.fn().mockResolvedValue(membership) },
    };

    await expect(syncLegacyTenantMembership(db, {
      tenant: { id: 't-1', name: 'Agency', code: 'AGENCY', isActive: true },
      user: { id: 'u-1', isActive: true },
    })).resolves.toBe(membership);

    expect(db.iamOrganization.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { externalSystem_externalId: { externalSystem: 'iacms-test', externalId: 't-1' } },
      create: expect.objectContaining({ slug: 'iacms-test-agency', isActive: true }),
      update: {},
    }));
    expect(db.iamMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { subjectId_organizationId: { subjectId: 'u-1', organizationId: 'org-1' } },
      create: expect.objectContaining({ status: 'active', externalSystem: 'iacms-test' }),
      update: {},
    }));
  });

  it('records an inactive membership for an inactive identity or organization', async () => {
    process.env.IAM_ORG_MEMBERSHIPS_ENABLED = 'true';
    const db = {
      iamOrganization: { upsert: vi.fn().mockResolvedValue({ id: 'org-1' }) },
      iamMembership: { upsert: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
    };

    await syncLegacyTenantMembership(db, {
      tenant: { id: 't-1', name: 'Agency', code: 'AGENCY', isActive: true },
      user: { id: 'u-1', isActive: false },
    });

    expect(db.iamMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'inactive' }),
    }));
  });
});
