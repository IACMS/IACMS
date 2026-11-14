import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createApiKey,
  listApiKeys,
  getApiKey,
  rotateApiKey,
  revokeApiKey,
  getScopes,
  validateApiKeyInternal,
  resolveApiKeyOwnerInternal,
} from '../../src/controllers/api-keys.controller.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
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

  describe('validateApiKeyInternal', () => {
    it('validates a hash and returns tenant and actor context without returning the hash', async () => {
      req.body = { keyHash: 'a'.repeat(64), ip: '127.0.0.1' };
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1', tenantId: 'tenant-test-1', name: 'Desk key', scopes: ['cases:read'],
        createdBy: 'user-admin-1', isActive: true, revokedAt: null, expiresAt: null,
        tenant: { isActive: true, code: 'TN1' },
      });
      prisma.apiKey.update.mockResolvedValue({});

      await validateApiKeyInternal(req, res, next);

      expect(prisma.apiKey.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { keyHash: 'a'.repeat(64) } }));
      expect(res.json).toHaveBeenCalledWith({
        apiKey: expect.objectContaining({ id: 'key-1', tenantCode: 'TN1', createdBy: 'user-admin-1' }),
      });
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('keyHash');
    });

    it('rejects malformed hashes', async () => {
      req.body = { keyHash: 'raw-api-key' };
      await validateApiKeyInternal(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveApiKeyOwnerInternal', () => {
    it('resolves the key owner within the requested tenant', async () => {
      req.body = { apiKeyId: 'key-1', tenantId: 'tenant-test-1' };
      prisma.apiKey.findFirst.mockResolvedValue({ createdBy: 'user-admin-1' });

      await resolveApiKeyOwnerInternal(req, res, next);

      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'key-1', tenantId: 'tenant-test-1' },
      }));
      expect(res.json).toHaveBeenCalledWith({ apiKeyContext: { createdBy: 'user-admin-1' } });
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

      const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const txCreate = vi.fn().mockResolvedValue({
        id: 'k-2',
        name: 'Rotated Key',
        keyPrefix: 'iacms_live_newprefix',
        scopes: ['cases:read'],
      });
      prisma.$transaction.mockImplementation(async (callback) => callback({ apiKey: { updateMany: txUpdateMany, create: txCreate } }));

      await rotateApiKey(req, res, next);

      expect(txUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'k-1', tenantId: 'tenant-test-1', isActive: true, revokedAt: null },
          data: expect.objectContaining({ isActive: false, revokedBy: 'user-admin-1' }),
        })
      );
      expect(txCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ createdBy: 'user-admin-1', keyHash: expect.any(String) }),
      }));
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/successfully rotated/i),
          apiKey: expect.objectContaining({ id: 'k-2' }),
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

  describe('getScopes', () => {
    it('returns available API key scopes', async () => {
      await getScopes(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        scopes: expect.arrayContaining(['*', 'cases:read', 'workflows:read']),
      });
    });
  });
});
