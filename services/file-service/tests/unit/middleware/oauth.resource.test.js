import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';

vi.mock('../../../src/config/index.js', () => ({
  default: {
    auth: {
      jwtSecret: 'test-secret',
      authServiceUrl: 'http://localhost:3001',
    },
  },
}));

vi.mock('../../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

const { authenticateToken } = await import('../../../src/api/middleware/auth.middleware.js');
const { requireScope } = await import('../../../src/api/middleware/scope.middleware.js');

describe('File Service OAuth 2.0 Resource Server Integration', () => {
  let privateKey;
  let publicJwk;
  const ISSUER = 'http://localhost:3001';
  const AUDIENCE = 'https://files.iacms.gov/api';

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-file-key-1';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    process.env.OIDC_JWKS_JSON = JSON.stringify({ keys: [publicJwk] });
    process.env.OIDC_ISSUER = ISSUER;
    process.env.SERVICE_AUDIENCE = AUDIENCE;
  });

  async function signToken(payload = {}, options = {}) {
    const builder = new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-file-key-1' })
      .setIssuer(options.issuer || ISSUER)
      .setAudience(options.audience !== undefined ? options.audience : AUDIENCE)
      .setExpirationTime(options.exp || '1h')
      .setSubject(options.sub || 'user-uuid-1234');

    return builder.sign(privateKey);
  }

  function runAuth(req) {
    return new Promise((resolve) => {
      const res = {};
      authenticateToken(req, res, (err) => resolve({ err, user: req.user, tenantId: req.tenantId }));
    });
  }

  function runScope(req, scopeName) {
    return new Promise((resolve) => {
      const middleware = requireScope(scopeName);
      const res = {};
      middleware(req, res, (err) => resolve({ err }));
    });
  }

  it('authenticates valid RS256 OAuth token offline via JWKS and populates req.user', async () => {
    const token = await signToken({
      tenant_id: 'tenant-court-99',
      scope: 'openid files:read files:write',
      roles: ['case_manager'],
      email: 'officer@court.gov',
    });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const { err, user, tenantId } = await runAuth(req);

    expect(err).toBeUndefined();
    expect(user).toBeDefined();
    expect(user.id).toBe('user-uuid-1234');
    expect(user.tenantId).toBe('tenant-court-99');
    expect(tenantId).toBe('tenant-court-99');
    expect(user.scopes).toEqual(['openid', 'files:read', 'files:write']);
    expect(user.roles).toEqual(['case_manager']);
    expect(req.headers['x-user-id']).toBe('user-uuid-1234');
    expect(req.headers['x-tenant-id']).toBe('tenant-court-99');
  });

  it('authenticates M2M API key token and sets isApiKey flag', async () => {
    const token = await signToken({
      tenant_id: 'tenant-external-agency',
      scope: 'files:*',
      roles: ['api_client'],
      api_key_id: 'key-record-uuid-88',
    }, { sub: 'api-key-client' });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const { err, user } = await runAuth(req);

    expect(err).toBeUndefined();
    expect(user.isApiKey).toBe(true);
    expect(user.apiKeyId).toBe('key-record-uuid-88');
    expect(user.scopes).toContain('files:*');
    expect(req.headers['x-api-key-id']).toBe('key-record-uuid-88');
  });

  it('authorizes file upload when user has files:write scope', async () => {
    const req = {
      user: {
        id: 'u1',
        scopes: ['files:write'],
        roles: [],
      },
    };

    const { err } = await runScope(req, 'file.upload');
    expect(err).toBeUndefined();
  });

  it('authorizes file read when user has wildcard files:* scope', async () => {
    const req = {
      user: {
        id: 'u1',
        scopes: ['files:*'],
        roles: [],
      },
    };

    const { err } = await runScope(req, 'file.read');
    expect(err).toBeUndefined();
  });

  it('authorizes file operations when token has universal * scope', async () => {
    const req = {
      user: {
        id: 'u1',
        scopes: ['*'],
        roles: [],
      },
    };

    const readRes = await runScope(req, 'file.read');
    const uploadRes = await runScope(req, 'file.upload');
    const deleteRes = await runScope(req, 'file.delete');

    expect(readRes.err).toBeUndefined();
    expect(uploadRes.err).toBeUndefined();
    expect(deleteRes.err).toBeUndefined();
  });

  it('rejects file delete when user only has files:read scope', async () => {
    const req = {
      user: {
        id: 'u1',
        scopes: ['files:read'],
        roles: [],
      },
    };

    const { err } = await runScope(req, 'file.delete');
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('Insufficient permissions');
  });

  it('rejects expired RS256 token immediately', async () => {
    const token = await signToken({
      tenant_id: 'tenant-1',
      scope: 'files:read',
    }, { exp: '-10s' });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const { err } = await runAuth(req);

    expect(err).toBeDefined();
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain('expired');
  });
});

