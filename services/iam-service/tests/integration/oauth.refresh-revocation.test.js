import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as jose from 'jose';
import crypto from 'crypto';
import Provider from 'oidc-provider';

describe('OAuth2 / OIDC Refresh Token Rotation & Revocation Integration Tests (Phase 3)', () => {
  let provider;
  let app;
  let testJwks;
  let testPublicJwks;
  let adapterStore = new Map();

  // Test adapter to verify grant family invalidation in-memory
  class TestMemoryAdapter {
    constructor(name) {
      this.name = name;
    }

    async upsert(id, payload, expiresIn) {
      const key = `${this.name}:${id}`;
      adapterStore.set(key, { payload, expiresAt: Date.now() + (expiresIn * 1000), consumed: null });
    }

    async find(id) {
      const key = `${this.name}:${id}`;
      const entry = adapterStore.get(key);
      if (!entry || (entry.expiresAt && entry.expiresAt < Date.now())) return undefined;
      return { ...entry.payload, consumed: entry.consumed };
    }

    async findByUserCode(userCode) {
      return undefined;
    }

    async findByUid(uid) {
      for (const [key, entry] of adapterStore.entries()) {
        if (key.startsWith(`${this.name}:`) && entry.payload?.uid === uid) {
          return { ...entry.payload, consumed: entry.consumed };
        }
      }
      return undefined;
    }

    async consume(id) {
      const key = `${this.name}:${id}`;
      const entry = adapterStore.get(key);
      if (entry) {
        entry.consumed = Date.now();
      }
    }

    async destroy(id) {
      adapterStore.delete(`${this.name}:${id}`);
    }

    async revokeByGrantId(grantId) {
      for (const [key, entry] of adapterStore.entries()) {
        if (entry.payload?.grantId === grantId) {
          adapterStore.delete(key);
        }
      }
    }
  }

  const testFindAccount = async (_ctx, sub) => ({
    accountId: sub,
    claims: async () => ({
      sub,
      email: 'pat.operator@iacms.org',
      email_verified: true,
      given_name: 'Pat',
      family_name: 'Operator',
      name: 'Pat Operator',
      tenant_id: 'tenant-rot-456',
      tenant_code: 'TENANT_ROT',
      roles: ['role-operator'],
    }),
  });

  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const pub = await jose.exportJWK(publicKey);
    const priv = await jose.exportJWK(privateKey);
    testJwks = { keys: [{ ...priv, use: 'sig', alg: 'RS256', kid: 'rot-test-key' }] };
    testPublicJwks = { keys: [{ ...pub, use: 'sig', alg: 'RS256', kid: 'rot-test-key' }] };

    provider = new Provider('http://127.0.0.1:3001', {
      adapter: TestMemoryAdapter,
      jwks: testJwks,
      cookies: { keys: ['01234567890123456789012345678901'] },
      scopes: ['openid', 'offline_access', 'profile', 'email', 'roles'],
      claims: {
        openid: ['sub'],
        profile: ['name', 'given_name', 'family_name', 'department_id', 'tenant_id', 'tenant_code'],
        email: ['email', 'email_verified'],
        roles: ['roles'],
      },
      routes: {
        authorization: '/oauth/authorize',
        token: '/oauth/token',
        userinfo: '/oauth/userinfo',
        jwks: '/oauth/jwks',
        revocation: '/oauth/token/revoke',
      },
      clients: [{
        client_id: 'spa-rot-client',
        token_endpoint_auth_method: 'none',
        redirect_uris: ['https://portal.iacms.local/callback'],
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        scope: 'openid offline_access profile email roles',
      }],
      features: {
        devInteractions: { enabled: false },
        revocation: { enabled: true },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => 'https://api.iacms.local',
          getResourceServerInfo: () => ({
            scope: 'openid offline_access profile email roles',
            audience: 'https://api.iacms.local',
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          }),
          useGrantedResource: () => true,
        },
      },
      formats: {
        AccessToken: 'jwt',
        customizers: {
          async jwt(ctx, token, jwt) {
            jwt.payload.tenant_id = 'tenant-rot-456';
            jwt.payload.tenant_code = 'TENANT_ROT';
            jwt.payload.roles = ['role-operator'];
          },
        },
      },
      rotateRefreshToken: true,
      findAccount: testFindAccount,
      interactions: {
        url(_ctx, interaction) {
          return '/oauth/interaction/' + interaction.uid;
        },
      },
    });

    app = express();
    const oidcCallback = provider.callback();

    app.use((req, res, next) => {
      const isOidcPath = (
        req.path.startsWith('/.well-known') ||
        (req.path.startsWith('/oauth') &&
         !req.path.startsWith('/oauth/clients') &&
         !req.path.startsWith('/oauth/interaction'))
      );
      if (isOidcPath) return oidcCallback(req, res);
      next();
    });

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.post('/oauth/interaction/:uid/login', async (req, res, next) => {
      try {
        const result = { login: { accountId: 'user-rot-88' } };
        await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
      } catch (e) { next(e); }
    });

    app.post('/oauth/interaction/:uid/confirm', async (req, res, next) => {
      try {
        const details = await provider.interactionDetails(req, res);
        const grant = details.grantId
          ? await provider.Grant.find(details.grantId)
          : new provider.Grant({ accountId: 'user-rot-88', clientId: 'spa-rot-client' });

        const missingOIDCScope = details.prompt?.details?.missingOIDCScope ?? ['openid', 'offline_access', 'profile', 'email', 'roles'];
        grant.addOIDCScope(missingOIDCScope.join(' '));

        const missingResourceScopes = details.prompt?.details?.missingResourceScopes ?? {};
        for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
          grant.addResourceScope(indicator, scopes.join(' '));
        }

        const grantId = await grant.save();
        await provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: true });
      } catch (e) { next(e); }
    });
  });

  // Helper to complete initial authorization code flow and obtain initial tokens
  async function performInitialAuthFlow(agent) {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const authRes = await agent
      .get('/oauth/authorize')
      .query({
        client_id: 'spa-rot-client',
        response_type: 'code',
        scope: 'openid offline_access profile email roles',
        redirect_uri: 'https://portal.iacms.local/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
        state: 'rot_state_1',
      });

    const loginUid = authRes.headers.location.split('/').pop();
    const loginRes = await agent
      .post(`/oauth/interaction/${loginUid}/login`)
      .send({ email: 'pat.operator@iacms.org', password: 'password123' });

    const resumeUrl1 = new URL(loginRes.headers.location, 'http://127.0.0.1:3001');
    const consentRedirect = await agent.get(resumeUrl1.pathname + resumeUrl1.search);
    const consentUid = consentRedirect.headers.location.split('/').pop();

    const consentRes = await agent.post(`/oauth/interaction/${consentUid}/confirm`);
    const resumeUrl2 = new URL(consentRes.headers.location, 'http://127.0.0.1:3001');
    const finalCallback = await agent.get(resumeUrl2.pathname + resumeUrl2.search);
    const callbackUrl = new URL(finalCallback.headers.location);
    const code = callbackUrl.searchParams.get('code');

    const tokenRes = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'spa-rot-client',
        code,
        redirect_uri: 'https://portal.iacms.local/callback',
        code_verifier: codeVerifier,
      });

    return tokenRes.body;
  }

  it('rotates refresh token on exchange and issues a new access token and rotated refresh token', async () => {
    const agent = request.agent(app);
    const initialTokens = await performInitialAuthFlow(agent);

    expect(initialTokens.access_token).toBeTruthy();
    expect(initialTokens.refresh_token).toBeTruthy();
    const originalRefreshToken = initialTokens.refresh_token;

    // Exchange refresh token for new pair
    const refreshRes = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'spa-rot-client',
        refresh_token: originalRefreshToken,
      });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toBeTruthy();
    expect(refreshRes.body.refresh_token).toBeTruthy();

    // Verify token rotation: new refresh token must be different from original
    expect(refreshRes.body.refresh_token).not.toBe(originalRefreshToken);

    // Verify claims in newly minted access token
    const newAtPayload = jose.decodeJwt(refreshRes.body.access_token);
    expect(newAtPayload.sub).toBe('user-rot-88');
    expect(newAtPayload.tenant_id).toBe('tenant-rot-456');
    expect(newAtPayload.tenant_code).toBe('TENANT_ROT');
    expect(newAtPayload.roles).toEqual(['role-operator']);
  });

  it('detects refresh token reuse and revokes the entire token family (revokeByGrantId)', async () => {
    const agent = request.agent(app);
    const initialTokens = await performInitialAuthFlow(agent);
    const originalRefreshToken = initialTokens.refresh_token;

    // Legitimate client rotates the refresh token (1st exchange)
    const legitExchange = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'spa-rot-client',
        refresh_token: originalRefreshToken,
      });

    expect(legitExchange.status).toBe(200);
    const rotatedRefreshToken = legitExchange.body.refresh_token;
    expect(rotatedRefreshToken).not.toBe(originalRefreshToken);

    // Attacker attempts to replay the OLD refresh token (reuse detection!)
    const replayRes = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'spa-rot-client',
        refresh_token: originalRefreshToken,
      });

    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe('invalid_grant');

    // Due to reuse detection, the entire grant family was invalidated!
    // The legitimate client's NEW rotated refresh token MUST now also be rejected
    const subsequentLegitAttempt = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'spa-rot-client',
        refresh_token: rotatedRefreshToken,
      });

    expect(subsequentLegitAttempt.status).toBe(400);
    expect(subsequentLegitAttempt.body.error).toBe('invalid_grant');
  });

  it('revokes refresh token explicitly via POST /oauth/token/revoke (RFC 7009)', async () => {
    const agent = request.agent(app);
    const tokens = await performInitialAuthFlow(agent);
    const refreshToken = tokens.refresh_token;

    // Call revocation endpoint
    const revokeRes = await agent
      .post('/oauth/token/revoke')
      .type('form')
      .send({
        client_id: 'spa-rot-client',
        token: refreshToken,
        token_type_hint: 'refresh_token',
      });

    expect(revokeRes.status).toBe(200);

    // Attempting to use revoked refresh token must fail
    const refreshAttempt = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'spa-rot-client',
        refresh_token: refreshToken,
      });

    expect(refreshAttempt.status).toBe(400);
    expect(refreshAttempt.body.error).toBe('invalid_grant');
  });

  it('handles revocation of unknown or already-revoked tokens gracefully (RFC 7009 no-op)', async () => {
    const agent = request.agent(app);

    const revokeRes = await agent
      .post('/oauth/token/revoke')
      .type('form')
      .send({
        client_id: 'spa-rot-client',
        token: 'already-revoked-or-bogus-token-xyz',
        token_type_hint: 'refresh_token',
      });

    // RFC 7009: Revoking an invalid or unrecognized token MUST return 200 OK
    expect(revokeRes.status).toBe(200);
  });
});
