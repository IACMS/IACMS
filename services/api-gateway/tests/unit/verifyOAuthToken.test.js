import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';
import { createOAuthResourceServer } from '../../../../shared/middleware/verifyOAuthToken.js';

describe('Universal OAuth Resource Server Middleware (verifyOAuthToken)', () => {
  let rsaPrivateKey;
  let rsaPublicKey;
  let testPublicJwks;
  let req;
  let res;
  let next;

  const ISSUER = 'http://localhost:3001';
  const AUDIENCE = 'https://files.iacms.gov/api';

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256', { extractable: true });
    rsaPrivateKey = keyPair.privateKey;
    rsaPublicKey = keyPair.publicKey;

    const pubJwk = await jose.exportJWK(rsaPublicKey);
    pubJwk.kid = 'test-resource-key';
    pubJwk.use = 'sig';
    pubJwk.alg = 'RS256';

    testPublicJwks = { keys: [pubJwk] };
    process.env.OIDC_JWKS_JSON = JSON.stringify(testPublicJwks);
    process.env.OIDC_ISSUER = ISSUER;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it('rejects request when no Authorization header is present', async () => {
    const middleware = createOAuthResourceServer({ issuer: ISSUER });
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'unauthorized' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticates valid RS256 token and stamps user context and headers', async () => {
    const token = await new jose.SignJWT({
      sub: 'user-officer-42',
      tenant_id: 'tenant-police-1',
      tenant_code: 'POLICE',
      department_id: 'dept-patrol',
      email: 'officer@police.gov',
      roles: ['officer'],
      scope: 'files:read files:upload',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-resource-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('1h')
      .sign(rsaPrivateKey);

    req.headers.authorization = `Bearer ${token}`;

    const middleware = createOAuthResourceServer({
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredScopes: ['files:read'],
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(
      expect.objectContaining({
        id: 'user-officer-42',
        tenantId: 'tenant-police-1',
        tenantCode: 'POLICE',
        departmentId: 'dept-patrol',
        email: 'officer@police.gov',
        roles: ['officer'],
        scopes: ['files:read', 'files:upload'],
      })
    );
    expect(req.headers['x-user-id']).toBe('user-officer-42');
    expect(req.headers['x-tenant-id']).toBe('tenant-police-1');
    expect(req.headers['x-user-roles']).toBe('officer');
  });

  it('rejects token when required scope is missing', async () => {
    const token = await new jose.SignJWT({
      sub: 'user-officer-42',
      tenant_id: 'tenant-police-1',
      roles: ['officer'],
      scope: 'files:read',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-resource-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('1h')
      .sign(rsaPrivateKey);

    req.headers.authorization = `Bearer ${token}`;

    const middleware = createOAuthResourceServer({
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredScopes: ['files:delete'],
    });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'insufficient_scope',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows token with wildcard scope * to access any required scope', async () => {
    const token = await new jose.SignJWT({
      sub: 'admin-partner-1',
      tenant_id: 'tenant-admin-1',
      roles: ['platform_admin'],
      scope: '*',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-resource-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('1h')
      .sign(rsaPrivateKey);

    req.headers.authorization = `Bearer ${token}`;

    const middleware = createOAuthResourceServer({
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredScopes: ['files:delete', 'files:admin'],
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects expired token with 401 token_expired', async () => {
    const token = await new jose.SignJWT({
      sub: 'user-officer-42',
      tenant_id: 'tenant-police-1',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-resource-key' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('0s') // immediately expired
      .sign(rsaPrivateKey);

    req.headers.authorization = `Bearer ${token}`;

    const middleware = createOAuthResourceServer({
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'token_expired',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticates M2M API Key token and stamps x-api-key-id header', async () => {
    const token = await new jose.SignJWT({
      sub: 'key:partner-script',
      tenant_id: 'tenant-justice-1',
      api_key_id: 'key-record-uuid-99',
      roles: ['partner_integration'],
      scope: 'chat:read chat:write',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-resource-key' })
      .setIssuer(ISSUER)
      .setAudience('https://chat.iacms.gov/api')
      .setExpirationTime('1h')
      .sign(rsaPrivateKey);

    req.headers.authorization = `Bearer ${token}`;

    const middleware = createOAuthResourceServer({
      issuer: ISSUER,
      audience: 'https://chat.iacms.gov/api',
      requiredScopes: ['chat:write'],
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.isApiKey).toBe(true);
    expect(req.user.apiKeyId).toBe('key-record-uuid-99');
    expect(req.headers['x-api-key-id']).toBe('key-record-uuid-99');
  });
});

