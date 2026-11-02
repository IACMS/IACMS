import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { apiKeyGrantHandler, GRANT_TYPE, _resetRateLimits } from '../../src/oauth/grants/api-key.grant.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn().mockResolvedValue() })),
}));

describe('api-key.grant unit tests (Phase 5: urn:iacms:grant:api_key)', () => {
  let ctx;
  let mockAccessToken;
  let mockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimits();

    mockAccessToken = vi.fn().mockImplementation(function (data) {
      this.client = data.client;
      this.scope = data.scope;
      this.tokenType = 'Bearer';
      this.claims = {};
      this.set = vi.fn((k, v) => { this.claims[k] = v; });
      this.save = vi.fn().mockResolvedValue('jwt-access-token-xyz');
    });

    mockProvider = {
      AccessToken: mockAccessToken,
    };

    ctx = {
      oidc: {
        provider: mockProvider,
        client: {
          clientId: 'iacms_api_key_client',
          [Symbol.for('tenant_id')]: null,
        },
        params: {
          grant_type: GRANT_TYPE,
          api_key: 'iacms_live_0123456789abcdef0123456789abcdef',
        },
      },
      ip: '192.168.1.100',
      status: 200,
      body: {},
    };
  });

  it('rejects request when api_key parameter is missing', async () => {
    delete ctx.oidc.params.api_key;

    await apiKeyGrantHandler(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toBe('invalid_request');
  });

  it('successfully exchanges valid API key for RS256 JWT access token', async () => {
    const rawKey = ctx.oidc.params.api_key;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-uuid-1',
      tenantId: 'tenant-police-1',
      keyHash,
      keyPrefix: rawKey.substring(0, 20),
      scopes: ['cases:read', 'cases:write'],
      isActive: true,
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      tenant: { id: 'tenant-police-1', code: 'POLICE', isActive: true },
    });

    await apiKeyGrantHandler(ctx);

    expect(ctx.status).toBe(200);
    expect(ctx.body.access_token).toBe('jwt-access-token-xyz');
    expect(ctx.body.token_type).toBe('Bearer');
    expect(ctx.body.expires_in).toBe(3600);

    // Verify lastUsed update called
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-uuid-1' },
      data: {
        lastUsedAt: expect.any(Date),
        lastUsedIp: '192.168.1.100',
      },
    });

    // Verify token claims set
    const atInstance = mockAccessToken.mock.results[0].value;
    expect(atInstance.set).toHaveBeenCalledWith('tenant_id', 'tenant-police-1');
    expect(atInstance.set).toHaveBeenCalledWith('tenant_code', 'POLICE');
    expect(atInstance.set).toHaveBeenCalledWith('api_key_id', 'key-uuid-1');
    expect(atInstance.set).toHaveBeenCalledWith('roles', ['api_key']);
  });

  it('rejects when API key is not found in database', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);

    await apiKeyGrantHandler(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toBe('invalid_grant');
    expect(ctx.body.error_description).toMatch(/Invalid or inactive/i);
  });

  it('rejects when API key is revoked', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-uuid-1',
      isActive: false,
      revokedAt: new Date(Date.now() - 10000),
      tenant: { isActive: true },
    });

    await apiKeyGrantHandler(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toBe('invalid_grant');
    expect(ctx.body.error_description).toMatch(/revoked|inactive/i);
  });

  it('rejects when API key has expired', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-uuid-1',
      isActive: true,
      expiresAt: new Date(Date.now() - 10000), // expired
      revokedAt: null,
      tenant: { isActive: true },
    });

    await apiKeyGrantHandler(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toBe('invalid_grant');
    expect(ctx.body.error_description).toMatch(/expired/i);
  });

  it('rejects when tenant is inactive', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-uuid-1',
      isActive: true,
      expiresAt: null,
      revokedAt: null,
      tenant: { isActive: false },
    });

    await apiKeyGrantHandler(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toBe('invalid_grant');
    expect(ctx.body.error_description).toMatch(/Tenant organization is inactive/i);
  });

  it('enforces tenant isolation if client is tenant-scoped', async () => {
    ctx.oidc.client[Symbol.for('tenant_id')] = 'other-tenant-id';

    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-uuid-1',
      tenantId: 'my-tenant-id',
      isActive: true,
      tenant: { isActive: true },
    });

    await apiKeyGrantHandler(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body.error).toBe('invalid_grant');
    expect(ctx.body.error_description).toMatch(/authorized organization/i);
  });

  it('enforces rate limit of 5 requests per second per key prefix', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-uuid-1',
      name: 'CI pipeline',
      prefix: 'iacms_live_01234567',
      hashedKey: crypto.createHash('sha256').update('iacms_live_0123456789abcdef0123456789abcdef').digest('hex'),
      isActive: true,
      scopes: ['iacms:read'],
      tenantId: 'tenant-uuid-1',
      tenant: { id: 'tenant-uuid-1', code: 'ACME', isActive: true },
    });

    for (let i = 0; i < 5; i++) {
      ctx.status = undefined;
      ctx.body = undefined;
      await apiKeyGrantHandler(ctx);
      expect(ctx.status).toBe(200);
    }

    // 6th request within same second window should be rate limited
    ctx.status = undefined;
    ctx.body = undefined;
    await apiKeyGrantHandler(ctx);
    expect(ctx.status).toBe(429);
    expect(ctx.body.error).toBe('slow_down');
  });
});
