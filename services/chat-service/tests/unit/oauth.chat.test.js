import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as jose from 'jose';
import { attachActor } from '../../src/middleware/actor.js';
import { authenticateWsRequestAsync } from '../../src/websocket/ws.auth.js';

describe('Chat Service OAuth 2.0 Resource Server Integration', () => {
  let privateKey;
  let publicJwk;
  const ISSUER = 'http://localhost:3001';
  const AUDIENCE = 'https://chat.iacms.gov/api';

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicJwk = await jose.exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-chat-key-1';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    process.env.OIDC_JWKS_JSON = JSON.stringify({ keys: [publicJwk] });
    process.env.OIDC_ISSUER = ISSUER;
    process.env.SERVICE_AUDIENCE = AUDIENCE;
  });

  async function signToken(payload = {}, options = {}) {
    const builder = new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-chat-key-1' })
      .setIssuer(options.issuer || ISSUER)
      .setAudience(options.audience !== undefined ? options.audience : AUDIENCE)
      .setExpirationTime(options.exp || '1h')
      .setSubject(options.sub || 'user-chat-999');

    return builder.sign(privateKey);
  }

  function runAttachActor(req) {
    return new Promise((resolve) => {
      const res = {};
      attachActor(req, res, (err) => resolve({ err, actor: req.actor, user: req.user }));
    });
  }

  describe('REST API (attachActor)', () => {
    it('authenticates direct RS256 OAuth token offline via JWKS', async () => {
      const token = await signToken({
        tenant_id: 'tenant-police-dept',
        department_id: 'dept-detectives',
        scope: 'chat:read chat:write',
        roles: ['case_manager'],
        email: 'detective@police.gov',
      });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const { err, actor, user } = await runAttachActor(req);

      expect(err).toBeUndefined();
      expect(actor).toBeDefined();
      expect(actor.userId).toBe('user-chat-999');
      expect(actor.tenantId).toBe('tenant-police-dept');
      expect(actor.departmentId).toBe('dept-detectives');
      expect(actor.scopes).toEqual(['chat:read', 'chat:write']);
      expect(user).toEqual(actor);
      expect(req.headers['x-user-id']).toBe('user-chat-999');
      expect(req.headers['x-tenant-id']).toBe('tenant-police-dept');
    });

    it('rejects expired RS256 Bearer token', async () => {
      const token = await signToken({
        tenant_id: 'tenant-police-dept',
        scope: 'chat:read',
      }, { exp: '-10s' });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const { err } = await runAttachActor(req);

      expect(err).toBeDefined();
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('expired');
    });

    it('falls back to gateway headers when provided', async () => {
      const req = {
        headers: {
          'x-tenant-id': 'tenant-gateway',
          'x-user-id': 'user-gateway',
          'x-department-id': 'dept-gateway',
        },
      };

      const { err, actor } = await runAttachActor(req);

      expect(err).toBeUndefined();
      expect(actor.tenantId).toBe('tenant-gateway');
      expect(actor.userId).toBe('user-gateway');
      expect(actor.departmentId).toBe('dept-gateway');
    });
  });

  describe('WebSocket Authentication (authenticateWsRequestAsync)', () => {
    it('authenticates RS256 token via query parameter (?token=...)', async () => {
      const token = await signToken({
        tenant_id: 'tenant-ws-dept',
        department_id: 'dept-ws',
        email: 'ws-agent@gov.org',
        first_name: 'John',
        last_name: 'Doe',
        scope: 'chat:read chat:write',
      }, { sub: 'ws-user-123' });

      const req = {
        url: `/ws?token=${token}`,
        headers: { host: 'localhost:3010' },
      };

      const user = await authenticateWsRequestAsync(req);
      expect(user).toBeDefined();
      expect(user.userId).toBe('ws-user-123');
      expect(user.tenantId).toBe('tenant-ws-dept');
      expect(user.firstName).toBe('John');
      expect(user.lastName).toBe('Doe');
      expect(user.scopes).toContain('chat:read');
    });

    it('authenticates RS256 token via Sec-WebSocket-Protocol header', async () => {
      const token = await signToken({
        tenant_id: 'tenant-proto-dept',
        email: 'proto@gov.org',
      }, { sub: 'proto-user-456' });

      const req = {
        url: '/ws',
        headers: {
          host: 'localhost:3010',
          'sec-websocket-protocol': `access_token, ${token}`,
        },
      };

      const user = await authenticateWsRequestAsync(req);
      expect(user).toBeDefined();
      expect(user.userId).toBe('proto-user-456');
      expect(user.tenantId).toBe('tenant-proto-dept');
    });

    it('returns null on invalid token signature', async () => {
      const req = {
        url: '/ws?token=invalid.jwt.token',
        headers: { host: 'localhost:3010' },
      };

      const user = await authenticateWsRequestAsync(req);
      expect(user).toBeNull();
    });
  });
});

