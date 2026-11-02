import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';
import jwt from 'jsonwebtoken';
const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
  process.env.OIDC_ISSUER = 'http://localhost:3001';
});

import { authenticate, validateJwtToken } from '../../src/middleware/auth.middleware.js';

vi.mock('../../src/utils/authPasswordStatus.js', () => ({
  fetchMustChangePasswordFromAuth: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/services/apiKey.service.js', () => ({
  validateApiKey: vi.fn(),
}));

describe('Gateway Authentication Middleware — RS256 OIDC & HMAC Token Verification', () => {
  let rsaPrivateKey;
  let testPublicJwks;
  let req;
  let res;
  let next;

  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    rsaPrivateKey = privateKey;
    const pubJwk = await jose.exportJWK(publicKey);
    pubJwk.kid = 'gateway-test-key';
    pubJwk.use = 'sig';
    pubJwk.alg = 'RS256';

    testPublicJwks = { keys: [pubJwk] };
    process.env.OIDC_JWKS_JSON = JSON.stringify(testPublicJwks);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'GET',
      path: '/api/v1/cases',
      headers: {},
      session: null,
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it('validates external RS256 JWT via JWKS and stamps downstream headers', async () => {
    const rs256Token = await new jose.SignJWT({
      sub: 'user-rs256-42',
      tenant_id: 'tenant-court-1',
      tenant_code: 'COURT',
      department_id: 'dept-legal',
      email: 'judge@court.gov',
      roles: ['judge', 'case_supervisor'],
      scope: 'openid profile email roles',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'gateway-test-key' })
      .setIssuer('http://localhost:3001')
      .setAudience('https://api.iacms.local')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(rsaPrivateKey);

    req.headers['authorization'] = `Bearer ${rs256Token}`;

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(
      expect.objectContaining({
        id: 'user-rs256-42',
        tenantId: 'tenant-court-1',
        departmentId: 'dept-legal',
        email: 'judge@court.gov',
        roles: ['judge', 'case_supervisor'],
      })
    );

    // Downstream service headers
    expect(req.headers['x-user-id']).toBe('user-rs256-42');
    expect(req.headers['x-tenant-id']).toBe('tenant-court-1');
    expect(req.headers['x-department-id']).toBe('dept-legal');
    expect(req.headers['x-user-roles']).toBe('judge,case_supervisor');
    expect(req.headers['x-user-email']).toBe('judge@court.gov');
  });

  it('validates M2M RS256 token from API key grant and stamps api-key context', async () => {
    const m2mToken = await new jose.SignJWT({
      sub: 'client-m2m-99',
      tenant_id: 'tenant-police-9',
      tenant_code: 'POLICE',
      api_key_id: 'key-record-uuid',
      roles: ['api_key'],
      scope: 'api_key cases:read',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'gateway-test-key' })
      .setIssuer('http://localhost:3001')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(rsaPrivateKey);

    req.headers['authorization'] = `Bearer ${m2mToken}`;

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.isApiKey).toBe(true);
    expect(req.headers['x-api-key-id']).toBe('key-record-uuid');
    expect(req.headers['x-api-key-scopes']).toBe('api_key,cases:read');
    expect(req.headers['x-tenant-id']).toBe('tenant-police-9');
  });

  it('rejects expired RS256 token with 401 TOKEN_EXPIRED', async () => {
    const expiredToken = await new jose.SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'gateway-test-key' })
      .setIssuer('http://localhost:3001')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1h ago
      .sign(rsaPrivateKey);

    req.headers['authorization'] = `Bearer ${expiredToken}`;

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('still validates internal legacy HMAC JWT using JWT_SECRET', async () => {
    const hmacToken = jwt.sign(
      {
        id: 'user-legacy-hmac-1',
        tenantId: 'tenant-legacy',
        email: 'internal@service.iacms',
        roles: ['admin'],
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    req.headers['authorization'] = `Bearer ${hmacToken}`;

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('user-legacy-hmac-1');
    expect(req.headers['x-user-id']).toBe('user-legacy-hmac-1');
  });

  it('skips authentication for public OIDC protocol endpoints', async () => {
    req.path = '/.well-known/openid-configuration';
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    req.path = '/oauth/jwks';
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

