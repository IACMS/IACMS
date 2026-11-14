import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../src/config/database.js';
import { enqueueIdentitySnapshot } from '../../src/identityEvents.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: { findUnique: vi.fn() },
    identityEventOutbox: { create: vi.fn() },
  },
}));

describe('IAM identity lifecycle outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('IAM_IDENTITY_OUTBOX_ENABLED', 'true');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('queues a credential-free identity snapshot', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'subject-1', tenantId: 'tenant-1', email: 'person@example.test', username: 'person',
      firstName: 'Test', lastName: 'Person', isActive: true, updatedAt: new Date('2026-01-01T00:00:00Z'),
      passwordHash: 'must-not-be-copied', resetPasswordToken: 'must-not-be-copied',
    });
    prisma.identityEventOutbox.create.mockResolvedValue({ eventId: 'event-1' });

    await enqueueIdentitySnapshot('subject-1');

    expect(prisma.identityEventOutbox.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        subjectId: 'subject-1',
        eventType: 'upsert',
        payload: expect.objectContaining({ subjectId: 'subject-1', tenantId: 'tenant-1', isActive: true }),
      }),
    }));
    const payload = prisma.identityEventOutbox.create.mock.calls[0][0].data.payload;
    expect(payload).not.toHaveProperty('passwordHash');
    expect(payload).not.toHaveProperty('resetPasswordToken');
  });

  it('queues one tenant-scoped projection event for each mapped IACMS membership', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'subject-global', tenantId: null, email: 'person@example.test', username: 'person',
      firstName: 'Test', lastName: 'Person', isActive: true, updatedAt: new Date('2026-01-01T00:00:00Z'),
      organizationMemberships: [
        { status: 'active', organization: { externalSystem: 'iacms', externalId: '11111111-1111-4111-8111-111111111111', isActive: true } },
        { status: 'suspended', organization: { externalSystem: 'iacms', externalId: '22222222-2222-4222-8222-222222222222', isActive: true } },
        { status: 'active', organization: { externalSystem: 'other-project', externalId: 'project-42', isActive: true } },
      ],
    });
    prisma.identityEventOutbox.create.mockResolvedValue({ eventId: 'event-1' });

    await enqueueIdentitySnapshot('subject-global');

    expect(prisma.identityEventOutbox.create).toHaveBeenCalledTimes(2);
    const payloads = prisma.identityEventOutbox.create.mock.calls.map(([call]) => call.data.payload);
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: '11111111-1111-4111-8111-111111111111', isActive: true }),
      expect.objectContaining({ tenantId: '22222222-2222-4222-8222-222222222222', isActive: false }),
    ]));
  });

  it('does not publish a local projection event for identities with no IACMS organization', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'subject-global', tenantId: null, email: 'person@example.test', username: 'person',
      firstName: 'Test', lastName: 'Person', isActive: true, updatedAt: new Date(),
      organizationMemberships: [{
        status: 'active', organization: { externalSystem: 'other-project', externalId: 'org-1', isActive: true },
      }],
    });
    await expect(enqueueIdentitySnapshot('subject-global')).resolves.toBeNull();
    expect(prisma.identityEventOutbox.create).not.toHaveBeenCalled();
  });

  it('does not touch IAM persistence until the outbox feature is enabled', async () => {
    vi.stubEnv('IAM_IDENTITY_OUTBOX_ENABLED', 'false');
    await expect(enqueueIdentitySnapshot('subject-1')).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
