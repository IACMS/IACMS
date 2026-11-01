import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as jose from 'jose';
import crypto from 'crypto';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    oAuthClient: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/config/database.js', () => ({
  default: mockPrisma,
}));

describe('oidc.config provider initialization and JWT customizer tests', () => {
  let originalEnv;
  let testJwks;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const pub = await jose.exportJWK(publicKey);
    const priv = await jose.exportJWK(privateKey);
    testJwks = { keys: [{ ...priv, use: 'sig', alg: 'RS256', kid: 'test-key-1' }] };

    process.env.OIDC_JWKS_JSON = JSON.stringify(testJwks);
    process.env.OIDC_COOKIE_SECRET = '01234567890123456789012345678901';
    process.env.CLIENT_SECRET_KEY = crypto.randomBytes(32).toString('hex');
    process.env.OIDC_ISSUER = 'http://localhost:3001';
    process.env.OIDC_DEFAULT_RESOURCE = 'https://api.iacms.local';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads provider instance with correct issuer and routes', async () => {
    const { default: provider } = await import('../../src/oauth/oidc.config.js');

    expect(provider).toBeDefined();
    expect(provider.issuer).toBe('http://localhost:3001');
    expect(typeof provider.callback).toBe('function');
    expect(typeof provider.Client.find).toBe('function');
  });

  it('customizer embeds tenant_id into Access Token JWT for client credentials', async () => {
    const { default: provider } = await import('../../src/oauth/oidc.config.js');

    mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({
      tenantId: 'tenant-uuid-custom',
    });

    const token = new provider.ClientCredentials({
      clientId: 'm2m-test-client',
      resource: 'https://api.iacms.local',
      scope: 'roles profile',
    });

    token.resourceServer = {
      accessTokenFormat: 'jwt',
      audience: 'https://api.iacms.local',
      jwt: { sign: { alg: 'RS256' } },
    };

    const jwt = await token.save();
    expect(typeof jwt).toBe('string');

    const decoded = jose.decodeJwt(jwt);
    expect(decoded.sub).toBe('m2m-test-client');
    expect(decoded.aud).toBe('https://api.iacms.local');
    expect(decoded.tenant_id).toBe('tenant-uuid-custom');
  });

  it('customizer embeds tenant_id, tenant_code, and roles into Access Token JWT when accountId is present', async () => {
    const { default: provider } = await import('../../src/oauth/oidc.config.js');

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user-uuid-99',
      email: 'user@iacms.org',
      firstName: 'Jane',
      lastName: 'Doe',
      isActive: true,
      isEmailVerified: true,
      tenantId: 'tenant-uuid-42',
      departmentId: 'dept-uuid-1',
      tenant: { code: 'TENANT42', isActive: true },
      userRoles: [{ roleId: 'role-admin' }],
    });

    const token = new provider.AccessToken({
      accountId: 'user-uuid-99',
      clientId: 'spa-client',
      resource: 'https://api.iacms.local',
      scope: 'openid profile roles',
    });

    token.client = { clientId: 'spa-client' };
    token.resourceServer = {
      accessTokenFormat: 'jwt',
      audience: 'https://api.iacms.local',
      jwt: { sign: { alg: 'RS256' } },
    };

    const jwt = await token.save();
    expect(typeof jwt).toBe('string');

    const decoded = jose.decodeJwt(jwt);
    expect(decoded.sub).toBe('user-uuid-99');
    expect(decoded.aud).toBe('https://api.iacms.local');
    expect(decoded.tenant_id).toBe('tenant-uuid-42');
    expect(decoded.tenant_code).toBe('TENANT42');
    expect(decoded.roles).toEqual(['role-admin']);
    expect(decoded.department_id).toBe('dept-uuid-1');
  });
});
