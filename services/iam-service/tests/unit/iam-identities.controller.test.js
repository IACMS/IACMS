import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../src/config/database.js';
import { createIamIdentity } from '../../src/controllers/iam-identities.controller.js';
import { enqueueIdentitySnapshot } from '../../src/identityEvents.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    role: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../src/identityEvents.js', () => ({ enqueueIdentitySnapshot: vi.fn().mockResolvedValue(null) }));

describe('IAM global identity creation', () => {
  let req;
  let res;
  let next;
  const previousFlag = process.env.IAM_GLOBAL_IDENTITIES_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.IAM_GLOBAL_IDENTITIES_ENABLED = 'true';
    req = {
      headers: { 'x-user-permissions': 'platform:manage_tenants' },
      body: { email: 'person@example.test', password: 'very-secure-password', firstName: 'Global', lastName: 'User' },
    };
    res = { status: vi.fn().mockReturnThis(), json: vi.fn((payload) => payload) };
    next = vi.fn();
  });

  it('creates a tenantless identity and queues its credential-free event in the same transaction', async () => {
    const identity = { id: 'subject-uuid', email: 'person@example.test', username: 'iam_subject', firstName: 'Global', lastName: 'User' };
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue(identity),
        findUnique: vi.fn().mockResolvedValue({ ...identity, tenantId: null, isActive: true, isEmailVerified: false, updatedAt: new Date() }),
      },
      identityEventOutbox: { create: vi.fn().mockResolvedValue({ eventId: 'event-1' }) },
    };
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    await createIamIdentity(req, res, next);

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: null, email: 'person@example.test' }),
    }));
    expect(enqueueIdentitySnapshot).toHaveBeenCalledWith('subject-uuid', 'upsert', tx);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ identity });
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps global identity creation disabled by default', async () => {
    process.env.IAM_GLOBAL_IDENTITIES_ENABLED = 'false';
    await createIamIdentity(req, res, next);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('rejects duplicate email addresses across legacy tenants and global identities', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing-subject' });
    await createIamIdentity(req, res, next);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.IAM_GLOBAL_IDENTITIES_ENABLED;
    else process.env.IAM_GLOBAL_IDENTITIES_ENABLED = previousFlag;
  });
});
