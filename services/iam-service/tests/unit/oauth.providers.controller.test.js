import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listProviders,
  createProvider,
  getProvider,
  updateProvider,
  deleteProvider,
} from '../../src/controllers/oauth-providers.controller.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    oAuthProvider: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../src/oauth/client-secret.utils.js', () => ({
  encryptClientSecret: vi.fn((plain) => `encrypted_${plain}`),
  decryptClientSecret: vi.fn((cipher) => cipher.replace('encrypted_', '')),
}));

describe('oauth-providers.controller unit tests', () => {
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
        'x-user-permissions': 'platform:manage_tenants',
        'x-user-id': 'admin-uuid',
      },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('platform admin authorization guard', () => {
    it('rejects caller without platform:manage_tenants permission', async () => {
      req.headers['x-user-permissions'] = 'tenant:manage_users';
      await listProviders(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/Only platform administrators/i) })
      );
    });
  });

  describe('listProviders', () => {
    it('returns list of configured OAuth providers without exposing encrypted secrets', async () => {
      prisma.oAuthProvider.findMany.mockResolvedValue([
        { id: 'prov-1', provider: 'google', clientId: 'g-client-id', isActive: true },
        { id: 'prov-2', provider: 'github', clientId: 'gh-client-id', isActive: true },
      ]);

      await listProviders(req, res, next);

      expect(prisma.oAuthProvider.findMany).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        providers: [
          { id: 'prov-1', provider: 'google', clientId: 'g-client-id', isActive: true },
          { id: 'prov-2', provider: 'github', clientId: 'gh-client-id', isActive: true },
        ],
      });
    });
  });

  describe('createProvider', () => {
    it('encrypts secret and creates provider', async () => {
      req.body = {
        provider: 'Google',
        clientId: 'google-client-id',
        clientSecret: 'super-secret-123',
        scopes: ['openid', 'email', 'profile'],
      };

      prisma.oAuthProvider.create.mockResolvedValue({
        id: 'prov-created-1',
        provider: 'google',
        clientId: 'google-client-id',
        scopes: ['openid', 'email', 'profile'],
        isActive: true,
      });

      await createProvider(req, res, next);

      expect(prisma.oAuthProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'google',
            clientId: 'google-client-id',
            clientSecretEnc: 'encrypted_super-secret-123',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        provider: expect.objectContaining({ id: 'prov-created-1', provider: 'google' }),
      });
    });

    it('rejects when required fields are missing', async () => {
      req.body = { provider: 'google' }; // missing clientId & secret
      await createProvider(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getProvider', () => {
    it('returns provider by id', async () => {
      req.params.id = 'prov-1';
      prisma.oAuthProvider.findUnique.mockResolvedValue({
        id: 'prov-1',
        provider: 'google',
        clientId: 'g-id',
      });

      await getProvider(req, res, next);

      expect(prisma.oAuthProvider.findUnique).toHaveBeenCalledWith({
        where: { id: 'prov-1' },
        select: expect.any(Object),
      });
      expect(res.json).toHaveBeenCalledWith({
        provider: expect.objectContaining({ id: 'prov-1' }),
      });
    });

    it('returns NotFoundError when provider does not exist', async () => {
      req.params.id = 'prov-missing';
      prisma.oAuthProvider.findUnique.mockResolvedValue(null);

      await getProvider(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/OAuth provider not found/i) })
      );
    });
  });

  describe('updateProvider', () => {
    it('updates provider and encrypts new clientSecret if provided', async () => {
      req.params.id = 'prov-1';
      req.body = {
        clientSecret: 'new-secret-xyz',
        isActive: false,
      };

      prisma.oAuthProvider.findUnique.mockResolvedValue({ id: 'prov-1' });
      prisma.oAuthProvider.update.mockResolvedValue({
        id: 'prov-1',
        provider: 'google',
        isActive: false,
      });

      await updateProvider(req, res, next);

      expect(prisma.oAuthProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prov-1' },
          data: expect.objectContaining({
            clientSecretEnc: 'encrypted_new-secret-xyz',
            isActive: false,
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        provider: expect.objectContaining({ id: 'prov-1', isActive: false }),
      });
    });
  });

  describe('deleteProvider', () => {
    it('deletes provider by ID', async () => {
      req.params.id = 'prov-1';
      prisma.oAuthProvider.findUnique.mockResolvedValue({ id: 'prov-1', provider: 'google' });
      prisma.oAuthProvider.delete.mockResolvedValue({});

      await deleteProvider(req, res, next);

      expect(prisma.oAuthProvider.delete).toHaveBeenCalledWith({ where: { id: 'prov-1' } });
      expect(res.json).toHaveBeenCalledWith({ message: 'OAuth provider deleted.' });
    });
  });
});
