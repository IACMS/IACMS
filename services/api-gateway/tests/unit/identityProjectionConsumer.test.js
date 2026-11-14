import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../src/config/database.js';
import { projectIdentity, projectSnapshot } from '../../src/workers/identityProjectionConsumer.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    identityProjection: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe('IAM identity projection consumer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a projection using stable IAM subject and IACMS tenant IDs', async () => {
    prisma.identityProjection.findUnique.mockResolvedValue(null);
    const event = {
      eventId: 'event-1', sequence: '17', type: 'upsert', subjectId: 'subject-1',
      occurredAt: '2026-01-01T00:00:00Z',
      identity: {
        subjectId: 'subject-1', tenantId: 'tenant-1', email: 'person@example.test', username: 'person',
        firstName: 'Test', lastName: 'Person', isActive: true, sourceUpdatedAt: '2026-01-01T00:00:00Z',
      },
    };

    await projectIdentity(event);

    expect(prisma.identityProjection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { subjectId_tenantId: { subjectId: 'subject-1', tenantId: 'tenant-1' } },
      create: expect.objectContaining({ subjectId: 'subject-1', tenantId: 'tenant-1', sourceVersion: 17n }),
      update: expect.objectContaining({ email: 'person@example.test', isActive: true, sourceVersion: 17n }),
    }));
  });

  it('ignores replayed or out-of-order events', async () => {
    prisma.identityProjection.findUnique.mockResolvedValue({ sourceVersion: 18n });
    await projectIdentity({
      eventId: 'event-old', sequence: '17', subjectId: 'subject-1',
      identity: { subjectId: 'subject-1', tenantId: 'tenant-1' },
    });
    expect(prisma.identityProjection.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed identity events', async () => {
    await expect(projectIdentity({ eventId: 'event-1' })).rejects.toThrow('Malformed IAM identity event');
  });

  it('does not create an IACMS projection for a global identity without an IACMS membership', async () => {
    await projectIdentity({
      eventId: 'event-global', sequence: '19', subjectId: 'global-subject',
      identity: { subjectId: 'global-subject', tenantId: null },
    });
    expect(prisma.identityProjection.findUnique).not.toHaveBeenCalled();
    expect(prisma.identityProjection.upsert).not.toHaveBeenCalled();
  });

  it('repairs the projection from a newer IAM snapshot without regressing the event version', async () => {
    prisma.identityProjection.findUnique.mockResolvedValue({
      sourceVersion: 18n,
      sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await projectSnapshot({
      subjectId: 'subject-1', tenantId: 'tenant-1', email: 'new@example.test', username: 'person',
      firstName: 'New', lastName: 'Person', isActive: false, sourceUpdatedAt: '2026-01-02T00:00:00Z',
    });
    expect(prisma.identityProjection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ email: 'new@example.test', isActive: false, sourceVersion: 18n }),
    }));
  });
});
