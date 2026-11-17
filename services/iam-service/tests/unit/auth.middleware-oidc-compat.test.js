import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';

const TEST_SECRET = 'test-secret-at-least-32-chars-long-123456';
process.env.JWT_SECRET = TEST_SECRET;
process.env.OIDC_ISSUER = 'http://localhost:3001';

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn(() => mockRedis),
  closeRedisClient: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../../src/config/database.js';
import { authenticateToken } from '../../src/middleware/auth.middleware.js';

describe('auth.middleware dual-token verification (HS256 & RS256 OIDC)', () => {
  let rsaPrivateKey;
  let rsaPublicKeyJwk;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);

    // Generate test RSA keypair for RS256 OIDC token tests
    const keyPair = await generateKeyPair('RS256');
    rsaPrivateKey = keyPair.privateKey;
    rsaPublicKeyJwk = await exportJWK(keyPair.publicKey);
    rsaPublicKeyJwk.kid = 'test-rsa-key';
    rsaPublicKeyJwk.use = 'sig';
    rsaPublicKeyJwk.alg = 'RS256';

    process.env.OIDC_JWKS_JSON = JSON.stringify({ keys: [rsaPublicKeyJwk] });
  });

  function makeReq(token) {
    return {
      headers: {
        authorization: token ? `Bearer ${token}` : undefined,
      },
    };
  }

  it('authenticates legacy HS256 session token and attaches req.user', async () => {
    const token = jwt.sign(
      { id: 'user-hs256-1', tenantId: 'tenant-1', roles: ['case_worker'], type: 'access' },
      TEST_SECRET,
      { expiresIn: '1h' },
    );

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-hs256-1',
      tenantId: 'tenant-1',
      mustChangePassword: false,
      userRoles: [{ role: { name: 'case_worker', slug: 'case-worker' } }],
    });

    const req = makeReq(token);
    const next = vi.fn();

    await authenticateToken(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('user-hs256-1');
    expect(req.user.tenantId).toBe('tenant-1');
  });

  it('authenticates RS256 OIDC access token and attaches req.iamAdminScope for platform admin', async () => {
    const oidcToken = await new SignJWT({
      tenant_id: 'admin-tenant',
      roles: ['system-admin'],
      iam_admin: true,
      scope: 'openid profile email iam:admin',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-rsa-key' })
      .setSubject('user-oidc-admin')
      .setIssuer('http://localhost:3001')
      .setAudience('http://localhost:3001/admin-api')
      .setExpirationTime('1h')
      .sign(rsaPrivateKey);

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-oidc-admin',
      tenantId: 'admin-tenant',
      mustChangePassword: false,
      userRoles: [{ role: { name: 'IAM Administrator', slug: 'iam-admin' } }],
    });

    const req = makeReq(oidcToken);
    const next = vi.fn();

    await authenticateToken(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('user-oidc-admin');
    expect(req.iamAdminScope).toEqual({
      type: 'platform',
      organizationId: null,
      tenantId: 'admin-tenant',
    });
  });

  it('rejects an invalid token that fails both HS256 and RS256 verification', async () => {
    const invalidToken = 'not.a.valid.jwt.token';
    const req = makeReq(invalidToken);
    const next = vi.fn();

    await authenticateToken(req, {}, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode || err.status).toBe(401);
  });
});

