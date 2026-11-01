import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    oAuthClient: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../src/config/database.js', () => ({
  default: mockPrisma,
}));

vi.mock('../../src/oauth/client-secret.utils.js', () => ({
  encryptClientSecret: vi.fn().mockReturnValue('mock-encrypted-secret'),
  decryptClientSecret: vi.fn().mockReturnValue('mock-decrypted-secret'),
}));

import {
  listClients,
  createClient,
  getClient,
  updateClient,
  rotateClientSecret,
  deleteClient,
} from '../../src/controllers/oauth-clients.controller.js';
import { ForbiddenError, ValidationError, NotFoundError } from '../../../../shared/common/errors.js';

describe('oauth-clients.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {
        'x-user-permissions': 'platform:manage_tenants',
        'x-user-id': 'admin-uuid',
      },
      params: {},
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it('rejects requests from non-platform administrators', async () => {
    req.headers['x-user-permissions'] = 'tenant:manage_users';
    await listClients(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('lists OAuth clients for platform admins', async () => {
    mockPrisma.oAuthClient.findMany.mockResolvedValueOnce([
      { id: 'c-1', clientId: 'iacms_123', name: 'App 1' },
    ]);

    await listClients(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      clients: [{ id: 'c-1', clientId: 'iacms_123', name: 'App 1' }],
    });
  });

  it('creates an OAuth client and returns plain secret once', async () => {
    req.body = {
      name: 'Portal App',
      redirectUris: ['https://portal.iacms.local/callback'],
    };

    mockPrisma.oAuthClient.create.mockResolvedValueOnce({
      id: 'c-new',
      clientId: 'iacms_random',
      name: 'Portal App',
      redirectUris: ['https://portal.iacms.local/callback'],
      isActive: true,
    });

    await createClient(req, res, next);

    expect(mockPrisma.oAuthClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Portal App',
          clientSecretCiphertext: 'mock-encrypted-secret',
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({ name: 'Portal App' }),
        clientSecret: expect.any(String),
      })
    );
  });

  it('fails client creation if name is missing', async () => {
    req.body = {};
    await createClient(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('gets a single client by id', async () => {
    req.params.id = 'c-1';
    mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({
      id: 'c-1',
      clientId: 'iacms_1',
      name: 'Test App',
    });

    await getClient(req, res, next);
    expect(res.json).toHaveBeenCalledWith({
      client: { id: 'c-1', clientId: 'iacms_1', name: 'Test App' },
    });
  });

  it('throws NotFoundError if client does not exist on getClient', async () => {
    req.params.id = 'c-missing';
    mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce(null);

    await getClient(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });

  it('updates a client', async () => {
    req.params.id = 'c-1';
    req.body = { name: 'Updated App Name' };

    mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({ id: 'c-1', clientId: 'iacms_1' });
    mockPrisma.oAuthClient.update.mockResolvedValueOnce({ id: 'c-1', name: 'Updated App Name' });

    await updateClient(req, res, next);
    expect(res.json).toHaveBeenCalledWith({
      client: { id: 'c-1', name: 'Updated App Name' },
    });
  });

  it('rotates client secret and returns new secret', async () => {
    req.params.id = 'c-1';
    mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({ id: 'c-1', clientId: 'iacms_1' });
    mockPrisma.oAuthClient.update.mockResolvedValueOnce({ id: 'c-1' });

    await rotateClientSecret(req, res, next);

    expect(mockPrisma.oAuthClient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1' },
        data: { clientSecretCiphertext: 'mock-encrypted-secret' },
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Client secret rotated.',
        clientSecret: expect.any(String),
      })
    );
  });

  it('deletes client', async () => {
    req.params.id = 'c-1';
    mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({ id: 'c-1', clientId: 'iacms_1' });
    mockPrisma.oAuthClient.delete.mockResolvedValueOnce({ id: 'c-1' });

    await deleteClient(req, res, next);
    expect(res.json).toHaveBeenCalledWith({ message: 'OAuth client deleted.' });
  });
});
