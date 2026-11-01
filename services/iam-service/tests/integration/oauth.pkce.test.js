import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as jose from 'jose';
import crypto from 'crypto';
import Provider from 'oidc-provider';

describe('OAuth2 / OIDC PKCE Authorization Code Integration Tests', () => {
  let provider;
  let app;
  let testJwks;
  let keystore;

  const validVerifier = crypto.randomBytes(32).toString('base64url');
  const validChallenge = crypto.createHash('sha256').update(validVerifier).digest('base64url');

  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const pub = await jose.exportJWK(publicKey);
    const priv = await jose.exportJWK(privateKey);
    testJwks = { keys: [{ ...priv, use: 'sig', alg: 'RS256', kid: 'pkce-test-key' }] };
    const testPublicJwks = { keys: [{ ...pub, use: 'sig', alg: 'RS256', kid: 'pkce-test-key' }] };

    const testFindAccount = async (_ctx, sub) => ({
      accountId: sub,
      claims: async () => ({
        sub,
        email: 'alex.case@iacms.org',
        email_verified: true,
        given_name: 'Alex',
        family_name: 'Case',
        name: 'Alex Case',
        tenant_id: 'tenant-pkce-123',
        tenant_code: 'TENANT_PKCE',
        roles: ['role-case-manager'],
      }),
    });

    provider = new Provider('http://127.0.0.1:3001', {
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
      },
      clients: [{
        client_id: 'spa-pkce-client',
        token_endpoint_auth_method: 'none',
        redirect_uris: ['https://portal.iacms.local/callback'],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        scope: 'openid profile email roles',
      }],
      features: {
        devInteractions: { enabled: false },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => 'https://api.iacms.local',
          getResourceServerInfo: () => ({
            scope: 'openid profile email roles',
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
            jwt.payload.tenant_id = 'tenant-pkce-123';
            jwt.payload.tenant_code = 'TENANT_PKCE';
            jwt.payload.roles = ['role-case-manager'];
          },
        },
      },
      findAccount: testFindAccount,
      interactions: {
        url(_ctx, interaction) {
          return '/oauth/interaction/' + interaction.uid;
        },
      },
    });

    app = express();
    const oidcCallback = provider.callback();

    const jwksStore = jose.createLocalJWKSet(testPublicJwks);

    // Custom UserInfo handler to support RS256 JWT access tokens with audience
    app.get('/oauth/userinfo', async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer eyJ')) {
        try {
          const rawToken = authHeader.slice(7);
          const { payload } = await jose.jwtVerify(rawToken, jwksStore, {
            issuer: 'http://127.0.0.1:3001',
          });
          const account = await testFindAccount(null, payload.sub);
          if (!account) return res.status(401).json({ error: 'invalid_token' });
          const claims = await account.claims('userinfo', payload.scope || 'openid profile email roles');
          return res.json(claims);
        } catch (e) {
          return res.status(401).json({ error: 'invalid_token', error_description: e.message });
        }
      }
      return oidcCallback(req, res);
    });

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

    // Mock interaction bridge for end-to-end test
    app.post('/oauth/interaction/:uid/login', async (req, res, next) => {
      try {
        const result = { login: { accountId: 'user-pkce-99' } };
        await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
      } catch (e) { next(e); }
    });

    app.post('/oauth/interaction/:uid/confirm', async (req, res, next) => {
      try {
        const details = await provider.interactionDetails(req, res);
        const grant = details.grantId
          ? await provider.Grant.find(details.grantId)
          : new provider.Grant({ accountId: 'user-pkce-99', clientId: 'spa-pkce-client' });

        const missingOIDCScope = details.prompt?.details?.missingOIDCScope ?? ['openid', 'profile', 'email', 'roles'];
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

  it('completes full Authorization Code + PKCE flow and issues RS256 JWT tokens', async () => {
    const agent = request.agent(app);

    // Step 1: Initiate /oauth/authorize with S256 code challenge
    const authRes = await agent
      .get('/oauth/authorize')
      .query({
        client_id: 'spa-pkce-client',
        response_type: 'code',
        scope: 'openid profile email roles',
        redirect_uri: 'https://portal.iacms.local/callback',
        code_challenge: validChallenge,
        code_challenge_method: 'S256',
        state: 'xyz_state_123',
      });

    expect(authRes.status).toBe(303);
    expect(authRes.headers.location).toMatch(/\/oauth\/interaction\//);
    const loginUid = authRes.headers.location.split('/').pop();

    // Step 2: User completes login
    const loginRes = await agent
      .post(`/oauth/interaction/${loginUid}/login`)
      .send({ email: 'alex.case@iacms.org', password: 'password123' });

    expect(loginRes.status).toBe(303);
    const resumeUrl1 = new URL(loginRes.headers.location, 'http://127.0.0.1:3001');

    // Step 3: Follow resume URL -> redirects to consent
    const consentRedirect = await agent.get(resumeUrl1.pathname + resumeUrl1.search);
    expect(consentRedirect.status).toBe(303);
    expect(consentRedirect.headers.location).toMatch(/\/oauth\/interaction\//);
    const consentUid = consentRedirect.headers.location.split('/').pop();

    // Step 4: User grants consent
    const consentRes = await agent.post(`/oauth/interaction/${consentUid}/confirm`);
    expect(consentRes.status).toBe(303);
    const resumeUrl2 = new URL(consentRes.headers.location, 'http://127.0.0.1:3001');

    // Step 5: Follow final resume URL -> redirects to client redirect_uri with ?code=...
    const finalCallback = await agent.get(resumeUrl2.pathname + resumeUrl2.search);
    expect(finalCallback.status).toBe(303);
    const callbackUrl = new URL(finalCallback.headers.location);

    expect(callbackUrl.origin).toBe('https://portal.iacms.local');
    expect(callbackUrl.pathname).toBe('/callback');
    expect(callbackUrl.searchParams.get('state')).toBe('xyz_state_123');

    const authCode = callbackUrl.searchParams.get('code');
    expect(authCode).toBeTruthy();

    // Step 6: Exchange authorization code at /oauth/token with code_verifier
    const tokenRes = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'spa-pkce-client',
        code: authCode,
        redirect_uri: 'https://portal.iacms.local/callback',
        code_verifier: validVerifier,
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.token_type).toBe('Bearer');
    expect(tokenRes.body.access_token).toBeTruthy();
    expect(tokenRes.body.id_token).toBeTruthy();

    // Step 7: Verify Access Token structure & custom claims
    const atHeader = jose.decodeProtectedHeader(tokenRes.body.access_token);
    expect(atHeader.alg).toBe('RS256');
    expect(atHeader.typ).toBe('at+jwt');

    const atPayload = jose.decodeJwt(tokenRes.body.access_token);
    expect(atPayload.sub).toBe('user-pkce-99');
    expect(atPayload.aud).toBe('https://api.iacms.local');
    expect(atPayload.tenant_id).toBe('tenant-pkce-123');
    expect(atPayload.tenant_code).toBe('TENANT_PKCE');
    expect(atPayload.roles).toEqual(['role-case-manager']);

    // Step 8: Verify ID Token structure & OIDC claims
    const idPayload = jose.decodeJwt(tokenRes.body.id_token);
    expect(idPayload.sub).toBe('user-pkce-99');
    expect(idPayload.email).toBe('alex.case@iacms.org');
    expect(idPayload.email_verified).toBe(true);
    expect(idPayload.name).toBe('Alex Case');
    expect(idPayload.roles).toEqual(['role-case-manager']);

    // Step 9: Validate UserInfo endpoint with Bearer access token
    const userinfoRes = await agent
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${tokenRes.body.access_token}`);

    expect(userinfoRes.status).toBe(200);
    expect(userinfoRes.body.sub).toBe('user-pkce-99');
    expect(userinfoRes.body.email).toBe('alex.case@iacms.org');
    expect(userinfoRes.body.tenant_id).toBe('tenant-pkce-123');
    expect(userinfoRes.body.roles).toEqual(['role-case-manager']);

    // Step 10: Negative Test — Single use consumption: cannot reuse the same code
    const reuseRes = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'spa-pkce-client',
        code: authCode,
        redirect_uri: 'https://portal.iacms.local/callback',
        code_verifier: validVerifier,
      });

    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.error).toBe('invalid_grant');
  });

  it('rejects token exchange if code_verifier does not match code_challenge', async () => {
    const agent = request.agent(app);

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // 1. Authorize
    const authRes = await agent
      .get('/oauth/authorize')
      .query({
        client_id: 'spa-pkce-client',
        response_type: 'code',
        scope: 'openid profile',
        redirect_uri: 'https://portal.iacms.local/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'st1',
      });

    const loginUid = authRes.headers.location.split('/').pop();

    // 2. Login
    const loginRes = await agent
      .post(`/oauth/interaction/${loginUid}/login`)
      .send({ email: 'alex.case@iacms.org', password: 'password123' });

    const resumeUrl1 = new URL(loginRes.headers.location, 'http://127.0.0.1:3001');
    const consentRedirect = await agent.get(resumeUrl1.pathname + resumeUrl1.search);
    const consentUid = consentRedirect.headers.location.split('/').pop();

    // 3. Confirm
    const consentRes = await agent.post(`/oauth/interaction/${consentUid}/confirm`);
    const resumeUrl2 = new URL(consentRes.headers.location, 'http://127.0.0.1:3001');
    const finalCallback = await agent.get(resumeUrl2.pathname + resumeUrl2.search);
    const callbackUrl = new URL(finalCallback.headers.location);
    const code = callbackUrl.searchParams.get('code');

    // 4. Attempt exchange with WRONG verifier
    const badTokenRes = await agent
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'spa-pkce-client',
        code,
        redirect_uri: 'https://portal.iacms.local/callback',
        code_verifier: 'wrong-verifier-123456789012345678901234567890',
      });

    expect(badTokenRes.status).toBe(400);
    expect(badTokenRes.body.error).toBe('invalid_grant');
  });

  it('rejects public client authorization request if PKCE is missing', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query({
        client_id: 'spa-pkce-client',
        response_type: 'code',
        scope: 'openid profile',
        redirect_uri: 'https://portal.iacms.local/callback',
        // Omitting code_challenge
      });

    expect(res.status).toBe(303);
    const redirectUrl = new URL(res.headers.location);
    expect(redirectUrl.origin).toBe('https://portal.iacms.local');
    expect(redirectUrl.pathname).toBe('/callback');
    expect(redirectUrl.searchParams.get('error')).toBe('invalid_request');
    expect(redirectUrl.searchParams.get('error_description')).toMatch(/PKCE/i);
  });
});
