import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as jose from 'jose';
import { createOAuthResourceServer } from '../../../../shared/middleware/verifyOAuthToken.js';

describe('Case Engine Service OAuth 2.0 Resource Server Integration', () => {
  let privateKey;
  let publicJwk;
  const ISSUER = 'http://localhost:3001';
  const AUDIENCE = 'https://cases.iacms.gov/api';
  const INTERNAL_TOKEN = 'test-gateway-internal-token-123';

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-case-key-1';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    process.env.OIDC_JWKS_JSON = JSON.stringify({ keys: [publicJwk] });
    process.env.OIDC_ISSUER = ISSUER;
    process.env.SERVICE_AUDIENCE = AUDIENCE;
    process.env.INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;
  });

  async function signToken(payload = {}, options = {}) {
    const builder = new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-case-key-1' })
      .setIssuer(options.issuer || ISSUER)
      .setAudience(options.audience !== undefined ? options.audience : AUDIENCE)
      .setExpirationTime(options.exp || '1h')
      .setSubject(options.sub || 'user-judge-100');

    return builder.sign(privateKey);
  }

  const oauthResourceServer = createOAuthResourceServer({
    audience: AUDIENCE,
    allowInternalToken: true,
  });

  function authenticateRequest(req, res, next) {
    if (req.headers['x-internal-service-token'] && req.headers['x-internal-service-token'] === process.env.INTERNAL_SERVICE_TOKEN) {
      return next();
    }
    return oauthResourceServer(req, res, next);
  }

  function runAuth(req) {
    return new Promise((resolve) => {
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          this.body = body;
          resolve({ res: this });
        },
      };
      authenticateRequest(req, res, (err) => resolve({ err, user: req.user, headers: req.headers }));
    });
  }

  it('authenticates direct RS256 Bearer JWT offline via JWKS and stamps downstream headers', async () => {
    const token = await signToken({
      tenant_id: 'tenant-high-court',
      department_id: 'dept-criminal',
      roles: ['case_manager', 'judge'],
      scope: 'cases:read cases:write cases:*',
      email: 'judge@court.gov',
    });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const { err, user, headers } = await runAuth(req);

    expect(err).toBeUndefined();
    expect(user).toBeDefined();
    expect(user.id).toBe('user-judge-100');
    expect(user.tenantId).toBe('tenant-high-court');
    expect(user.roles).toContain('judge');
    expect(user.scopes).toContain('cases:write');

    expect(headers['x-user-id']).toBe('user-judge-100');
    expect(headers['x-tenant-id']).toBe('tenant-high-court');
    expect(headers['x-user-roles']).toBe('case_manager,judge');
  });

  it('authenticates M2M API key token and sets isApiKey and x-api-key-id', async () => {
    const token = await signToken({
      tenant_id: 'tenant-police-agency',
      scope: 'cases:read',
      roles: ['api_client'],
      api_key_id: 'key-uuid-case-sync-99',
    }, { sub: 'api-service-sync' });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const { err, user, headers } = await runAuth(req);

    expect(err).toBeUndefined();
    expect(user.isApiKey).toBe(true);
    expect(user.apiKeyId).toBe('key-uuid-case-sync-99');
    expect(headers['x-api-key-id']).toBe('key-uuid-case-sync-99');
    expect(headers['x-user-id']).toBe('api-service-sync');
  });

  it('rejects expired RS256 Bearer token with 401 token_expired', async () => {
    const token = await signToken({
      tenant_id: 'tenant-court',
      scope: 'cases:read',
    }, { exp: '-10s' });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const { res } = await runAuth(req);

    expect(res).toBeDefined();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('token_expired');
  });

  it('bypasses OAuth verification when valid internal service token is provided (Gateway fast-path)', async () => {
    const req = {
      headers: {
        'x-internal-service-token': INTERNAL_TOKEN,
        'x-user-id': 'gateway-user-1',
        'x-tenant-id': 'gateway-tenant-1',
        'x-user-roles': 'tenant_admin',
      },
    };

    const { err, headers } = await runAuth(req);

    expect(err).toBeUndefined();
    expect(headers['x-user-id']).toBe('gateway-user-1');
    expect(headers['x-tenant-id']).toBe('gateway-tenant-1');
  });

  it('rejects unauthenticated requests without token or internal header with 401', async () => {
    const req = { headers: {} };
    const { res } = await runAuth(req);

    expect(res).toBeDefined();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });
});
