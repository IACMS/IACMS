import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    iamOrganization: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    iamMembership: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    role: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/config/database.js', () => ({ default: mockPrisma }));
vi.mock('../../src/identityEvents.js', () => ({ enqueueIdentitySnapshot: vi.fn().mockResolvedValue(null) }));

import {
  addIamOrganizationMember,
  createIamOrganization,
  listIamOrganizationMembers,
  updateIamOrganizationMember,
  updateIamOrganization,
} from '../../src/controllers/iam-organizations.controller.js';
import { NotFoundError, ValidationError } from '../../src/iamErrors.js';
import { enqueueIdentitySnapshot } from '../../src/identityEvents.js';

describe('IAM organization controller', () => {
  const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let req; let res; let next;
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
    req = {
      headers: {
        'x-user-permissions': 'platform:manage_tenants',
        'x-internal-service-token': process.env.INTERNAL_SERVICE_TOKEN || 'iacms-internal-service-token-dev',
      },
      params: {},
      body: {},
    };
    res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    next = vi.fn();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('creates a generic organization without an IACMS tenant reference', async () => {
    req.body = { name: 'Next Project', slug: 'next-project' };
    mockPrisma.iamOrganization.create.mockResolvedValueOnce({ id: 'org-1', name: 'Next Project', slug: 'next-project' });

    await createIamOrganization(req, res, next);

    expect(mockPrisma.iamOrganization.create).toHaveBeenCalledWith({
      data: { name: 'Next Project', slug: 'next-project', externalSystem: null, externalId: null, metadata: null },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('requires external organization identifiers as a pair', async () => {
    req.body = { name: 'Next Project', slug: 'next-project', externalSystem: 'project-a' };
    await createIamOrganization(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('supports deactivating an organization without deleting membership history', async () => {
    req.params.organizationId = organizationId;
    req.body = { isActive: false };
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce({ id: organizationId });
    mockPrisma.iamOrganization.update.mockResolvedValueOnce({ id: organizationId, isActive: false });

    await updateIamOrganization(req, res, next);

    expect(mockPrisma.iamOrganization.update).toHaveBeenCalledWith({
      where: { id: organizationId }, data: { isActive: false },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('queues tenant projection updates when an IACMS organization is deactivated', async () => {
    vi.stubEnv('IAM_IDENTITY_OUTBOX_ENABLED', 'true');
    req.params.organizationId = organizationId;
    req.body = { isActive: false };
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce({ id: organizationId, isActive: true, externalSystem: 'iacms' });
    mockPrisma.iamOrganization.update.mockResolvedValueOnce({ id: organizationId, isActive: false });
    mockPrisma.iamMembership.findMany.mockResolvedValueOnce([
      { subjectId: '11111111-1111-4111-8111-111111111111' },
      { subjectId: '22222222-2222-4222-8222-222222222222' },
    ]);

    await updateIamOrganization(req, res, next);

    expect(enqueueIdentitySnapshot).toHaveBeenCalledTimes(2);
    expect(enqueueIdentitySnapshot).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'upsert', mockPrisma);
    expect(next).not.toHaveBeenCalled();
  });

  it('adds an active existing identity to an active organization', async () => {
    req.params.organizationId = organizationId;
    req.body = { subjectId: '11111111-1111-4111-8111-111111111111' };
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce({ id: organizationId, isActive: true });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: req.body.subjectId, isActive: true });
    mockPrisma.iamMembership.upsert.mockResolvedValueOnce({ id: 'membership-1', status: 'active' });

    await addIamOrganizationMember(req, res, next);

    expect(mockPrisma.iamMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { subjectId_organizationId: { subjectId: req.body.subjectId, organizationId } },
      create: expect.objectContaining({ status: 'active' }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not activate an inactive identity through membership management', async () => {
    req.params.organizationId = organizationId;
    req.body = { subjectId: '11111111-1111-4111-8111-111111111111' };
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce({ id: organizationId, isActive: true });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: req.body.subjectId, isActive: false });

    await addIamOrganizationMember(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockPrisma.iamMembership.upsert).not.toHaveBeenCalled();
  });

  it('updates membership state while preserving the identity and organization IDs', async () => {
    req.params = { organizationId, subjectId: '11111111-1111-4111-8111-111111111111' };
    req.body = { status: 'suspended' };
    mockPrisma.iamMembership.findUnique.mockResolvedValueOnce({ id: 'membership-1' });
    mockPrisma.iamMembership.update.mockResolvedValueOnce({ id: 'membership-1', status: 'suspended' });

    await updateIamOrganizationMember(req, res, next);

    expect(mockPrisma.iamMembership.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'membership-1' }, data: { status: 'suspended' },
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns membership identities without credential fields', async () => {
    req.params.organizationId = organizationId;
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce({ id: organizationId });
    mockPrisma.iamMembership.findMany.mockResolvedValueOnce([]);

    await listIamOrganizationMembers(req, res, next);

    expect(mockPrisma.iamMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ subject: { select: { email: true, firstName: true, lastName: true, isActive: true } } }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns not found for unknown organizations', async () => {
    req.params.organizationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mockPrisma.iamOrganization.findUnique.mockResolvedValueOnce(null);
    await listIamOrganizationMembers(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });
});
