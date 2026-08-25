import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import prisma from '../../src/config/database.js';
import { generateApiKey, validateApiKey, revokeApiKey, rotateApiKey } from '../../src/services/apiKey.service.js';
import { UnauthorizedError } from '../../../../shared/common/errors.js';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      apiKey: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn()
      }
    }
  };
});

describe('apiKey.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateApiKey', () => {
    it('should create an api key with prefix iacms_live_', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'key-123',
        keyPrefix: 'iacms_live_mock',
        name: 'test key',
        scopes: ['read']
      });

      const result = await generateApiKey('tenant-1', 'test key', ['read'], null, 'user-1');
      expect(result.rawKey.startsWith('iacms_live_')).toBe(true);
      expect(prisma.apiKey.create).toHaveBeenCalledOnce();
      expect(prisma.apiKey.create.mock.calls[0][0].data.tenantId).toBe('tenant-1');
    });
  });

  describe('validateApiKey', () => {
    it('should validate and return key info', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-123',
        isActive: true,
        tenantId: 'tenant-1',
        scopes: ['read'],
        name: 'test key',
        tenant: {
          isActive: true,
          code: 'TN1'
        }
      });
      prisma.apiKey.update.mockResolvedValue({});

      const result = await validateApiKey('iacms_live_testkey', '127.0.0.1');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.tenantCode).toBe('TN1');
      expect(prisma.apiKey.update).toHaveBeenCalledOnce(); // for lastUsed
    });

    it('should throw UnauthorizedError if key is not found', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);
      await expect(validateApiKey('iacms_live_bad', '127.0.0.1')).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError if key is inactive', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({ isActive: false });
      await expect(validateApiKey('iacms_live_test', '127.0.0.1')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('revokeApiKey', () => {
    it('should update key to isActive false', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({ id: 'key-123', tenantId: 'tenant-1' });
      prisma.apiKey.update.mockResolvedValue({});

      await revokeApiKey('key-123', 'tenant-1', 'user-1');
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-123' },
        data: expect.objectContaining({ isActive: false, revokedBy: 'user-1' })
      });
    });
  });

  describe('rotateApiKey', () => {
    it('should revoke old key and create new one', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-123',
        tenantId: 'tenant-1',
        name: 'test key',
        scopes: ['read'],
        expiresAt: null
      });
      prisma.apiKey.update.mockResolvedValue({});
      prisma.apiKey.create.mockResolvedValue({
        id: 'key-124',
        keyPrefix: 'iacms_live_new',
        name: 'test key',
        scopes: ['read']
      });

      const result = await rotateApiKey('key-123', 'tenant-1', 'user-1');
      expect(prisma.apiKey.update).toHaveBeenCalled(); // revocation
      expect(prisma.apiKey.create).toHaveBeenCalled(); // creation
      expect(result.keyPrefix).toBe('iacms_live_new');
    });
  });
});
