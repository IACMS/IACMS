import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createApiKey,
  listApiKeys,
  getApiKey,
  rotateApiKey,
  revokeApiKey,
} from '../../src/controllers/api-keys.controller.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn().mockResolvedValue() })),
}));

describe('api-keys.controller unit tests', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      params: {},
      query: {},
      body: {},
      headers: {
        'x-tenant-id': 'tenant-test-1',
        'x-user-id': 'user-admin-1',
      },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('createApiKey', () => {
    it('creates API key, generates rawKey with iacms_live_ prefix and returns it once', async () => {
      req.body = {
        name: 'Desk Integration',
        scopes: ['cases:read', 'cases:write'],
      };

      prisma.apiKey.create.mockResolvedValue({
        id: 'key-1',
        tenantId: 'tenant-test-1',
        name: 'Desk Integration',
        keyPrefix: 'iacms_live_12345678',
        scopes: ['cases:read', 'cases:write'],
        isActive: true,
      });

      await createApiKey(req, res, next);

      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-test-1',
            name: 'Desk Integration',
            keyPrefix: expect.stringMatching(/^iacms_live_/),
            keyHash: expect.any(String),
            scopes: ['cases:read', 'cases:write'],
            createdBy: 'user-admin-1',
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: expect.objectContaining({ id: 'key-1' }),
          rawKey: expect.stringMatching(/^iacms_live_/),
        })
      );
    });

    it('rejects creation when name is missing', async () => {
      req.body = {};
      await createApiKey(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('listApiKeys', () => {
    it('returns API keys scoped to caller tenant without exposing keyHash', async () => {
      prisma.apiKey.findMany.mockResolvedValue([
        { id: 'k-1', name: 'Key 1', keyPrefix: 'iacms_live_1' },
        { id: 'k-2', name: 'Key 2', keyPrefix: 'iacms_live_2' },
      ]);

      await listApiKeys(req, res, next);

      expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-test-1' },
        select: expect.not.objectContaining({ keyHash: true }),
        orderBy: { createdAt: 'desc' },
      });
      expect(res.json).toHaveBeenCalledWith({
        apiKeys: expect.any(Array),
      });
    });
  });

  describe('rotateApiKey', () => {
    it('rotates API key and returns new raw key once', async () => {
      req.params.id = 'k-1';
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'k-1',
        tenantId: 'tenant-test-1',
        isActive: true,
        revokedAt: null,
      });

      prisma.apiKey.update.mockResolvedValue({
        id: 'k-1',
        name: 'Rotated Key',
        keyPrefix: 'iacms_live_newprefix',
      });

      await rotateApiKey(req, res, next);

      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'k-1' },
          data: expect.objectContaining({
            keyPrefix: expect.stringMatching(/^iacms_live_/),
            keyHash: expect.any(String),
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/successfully rotated/i),
          rawKey: expect.stringMatching(/^iacms_live_/),
        })
      );
    });

    it('rejects rotation if key is revoked', async () => {
      req.params.id = 'k-revoked';
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'k-revoked',
        tenantId: 'tenant-test-1',
        isActive: false,
        revokedAt: new Date(),
      });

      await rotateApiKey(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('revokeApiKey', () => {
    it('revokes API key and sets revokedBy', async () => {
      req.params.id = 'k-1';
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'k-1',
        tenantId: 'tenant-test-1',
      });
      prisma.apiKey.update.mockResolvedValue({});

      await revokeApiKey(req, res, next);

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'k-1' },
        data: {
          isActive: false,
          revokedAt: expect.any(Date),
          revokedBy: 'user-admin-1',
        },
      });
      expect(res.json).toHaveBeenCalledWith({ message: 'API key revoked successfully.' });
    });
  });
});
