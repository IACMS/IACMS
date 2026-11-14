import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../src/config/database.js';
import { listIdentitySnapshotInternal, setIdentityActiveInternal, updateIdentityInternal } from '../../src/controllers/internal-identities.controller.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../../src/identityEvents.js', () => ({ enqueueIdentitySnapshot: vi.fn().mockResolvedValue(null) }));

describe('IAM internal identity endpoints', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { params: { id: 'subject-1' }, headers: { 'x-tenant-id': 'tenant-1' }, body: { firstName: 'Updated' } };
    res = { json: vi.fn((value) => value) };
    next = vi.fn();
  });

  it('scopes profile updates to the supplied tenant and updates allowlisted fields only', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'subject-1', tenantId: 'tenant-1' });
    prisma.user.update.mockResolvedValue({ id: 'subject-1', firstName: 'Updated' });
    await updateIdentityInternal(req, res, next);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: 'subject-1', tenantId: 'tenant-1' } });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { firstName: 'Updated' } }));
    expect(res.json).toHaveBeenCalledWith({ user: { id: 'subject-1', firstName: 'Updated' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects credential fields', async () => {
    req.body = { passwordHash: 'nope' };
    await updateIdentityInternal(req, res, next);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('updates account active state only for a matching tenant user', async () => {
    req.body = { isActive: false };
    prisma.user.findFirst.mockResolvedValue({ id: 'subject-1', tenantId: 'tenant-1' });
    prisma.user.update.mockResolvedValue({ id: 'subject-1', isActive: false });
    await setIdentityActiveInternal(req, res, next);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
    expect(res.json).toHaveBeenCalledWith({ user: { id: 'subject-1', isActive: false } });
  });

  it('returns a paginated identity-only snapshot without credential fields', async () => {
    req.query = { limit: '1' };
    prisma.user.findMany.mockResolvedValue([
      { id: 'subject-1', tenantId: 'tenant-1', email: 'a@example.test', username: 'a', firstName: 'A', lastName: 'User', isActive: true, updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'subject-2', tenantId: 'tenant-1', email: 'b@example.test', username: 'b', firstName: 'B', lastName: 'User', isActive: true, updatedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    await listIdentitySnapshotInternal(req, res, next);
    const response = res.json.mock.calls[0][0];
    expect(response.users).toHaveLength(1);
    expect(response.nextCursor).toBe('subject-1');
    expect(response.users[0]).not.toHaveProperty('passwordHash');
  });

  it('includes each mapped IACMS tenant for tenantless identities in projection reconciliation', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{
      id: '11111111-1111-4111-8111-111111111111', tenantId: null,
      email: 'global@example.test', username: 'global', firstName: 'Global', lastName: 'User',
      isActive: true, updatedAt: new Date('2026-01-01T00:00:00Z'),
      organizationMemberships: [{
        status: 'active',
        organization: {
          externalSystem: 'iacms', externalId: '22222222-2222-4222-8222-222222222222', isActive: true,
        },
      }],
    }]);
    await listIdentitySnapshotInternal({ query: {} }, res, next);

    expect(res.json.mock.calls[0][0].users).toEqual([expect.objectContaining({
      subjectId: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      isActive: true,
    })]);
  });
});
