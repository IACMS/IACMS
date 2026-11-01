import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    oidcPayload: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../../src/config/database.js', () => ({
  default: mockPrisma,
}));

import { PrismaAdapter } from '../../src/oauth/prisma.adapter.js';

describe('PrismaAdapter unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts a payload with calculated expiresAt and mapped fields', async () => {
    const adapter = new PrismaAdapter('AuthorizationCode');
    const payload = { grantId: 'grant-1', userCode: 'uc-1', uid: 'uid-1', foo: 'bar' };

    await adapter.upsert('code-123', payload, 300);

    expect(mockPrisma.oidcPayload.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'code-123' },
        create: expect.objectContaining({
          id: 'code-123',
          modelName: 'AuthorizationCode',
          payload,
          grantId: 'grant-1',
          userCode: 'uc-1',
          uid: 'uid-1',
        }),
        update: expect.objectContaining({
          payload,
          grantId: 'grant-1',
        }),
      })
    );
  });

  it('finds a record by id and maps payload and consumedAt timestamp', async () => {
    const adapter = new PrismaAdapter('AuthorizationCode');
    const consumedDate = new Date('2026-11-01T12:00:00Z');

    mockPrisma.oidcPayload.findFirst.mockResolvedValueOnce({
      id: 'code-123',
      modelName: 'AuthorizationCode',
      payload: { sub: 'user-1' },
      consumedAt: consumedDate,
    });

    const result = await adapter.find('code-123');

    expect(mockPrisma.oidcPayload.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'code-123',
        modelName: 'AuthorizationCode',
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
    });
    expect(result).toEqual({
      sub: 'user-1',
      consumed: Math.floor(consumedDate.getTime() / 1000),
    });
  });

  it('returns undefined when record is not found in find()', async () => {
    const adapter = new PrismaAdapter('Session');
    mockPrisma.oidcPayload.findFirst.mockResolvedValueOnce(null);

    const result = await adapter.find('missing-id');
    expect(result).toBeUndefined();
  });

  it('finds by userCode and by uid', async () => {
    const adapter = new PrismaAdapter('DeviceCode');
    mockPrisma.oidcPayload.findFirst.mockResolvedValueOnce({
      id: 'device-1',
      payload: { code: '1234' },
      consumedAt: null,
    });

    const byUserCode = await adapter.findByUserCode('UC-999');
    expect(mockPrisma.oidcPayload.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userCode: 'UC-999', modelName: 'DeviceCode' }),
      })
    );
    expect(byUserCode).toEqual({ code: '1234' });

    mockPrisma.oidcPayload.findFirst.mockResolvedValueOnce({
      id: 'session-1',
      payload: { accountId: 'u-1' },
      consumedAt: null,
    });

    const byUid = await adapter.findByUid('uid-abc');
    expect(mockPrisma.oidcPayload.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ uid: 'uid-abc', modelName: 'DeviceCode' }),
      })
    );
    expect(byUid).toEqual({ accountId: 'u-1' });
  });

  it('executes atomic consume via $executeRaw checking consumed_at IS NULL', async () => {
    const adapter = new PrismaAdapter('AuthorizationCode');
    await adapter.consume('code-to-consume');

    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
  });

  it('destroys single record by id and modelName', async () => {
    const adapter = new PrismaAdapter('Session');
    await adapter.destroy('sess-123');

    expect(mockPrisma.oidcPayload.deleteMany).toHaveBeenCalledWith({
      where: { id: 'sess-123', modelName: 'Session' },
    });
  });

  it('revokes all records by grantId', async () => {
    const adapter = new PrismaAdapter('Grant');
    await adapter.revokeByGrantId('grant-xyz');

    expect(mockPrisma.oidcPayload.deleteMany).toHaveBeenCalledWith({
      where: { grantId: 'grant-xyz' },
    });
  });
});
