import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jose from 'jose';
import crypto from 'crypto';
import Provider from 'oidc-provider';
import request from 'supertest';
import express from 'express';

vi.mock('../../src/config/database.js', () => ({
  default: {
    role: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    oAuthClient: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userRole: {
      upsert: vi.fn(),
    },
    userApplicationRole: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockImplementation(async (pwd) => `hashed:${pwd}`),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import prisma from '../../src/config/database.js';
import { seedAdminPortalClient } from '../../scripts/seed-admin-portal-client.js';

describe('Phase 2B Step 1: iam_admin_portal OAuth client seed & configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;

    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', slug: 'iam-admin' });
    prisma.role.create.mockImplementation(async ({ data }) => ({ id: 'role-created', ...data }));
    prisma.role.update.mockImplementation(async ({ data }) => ({ id: 'role-updated', ...data }));
    prisma.oAuthClient.upsert.mockResolvedValue({ id: 'client-1', clientId: 'iam_admin_portal' });
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', code: 'ADMIN' });
    prisma.tenant.create.mockResolvedValue({ id: 'tenant-1', code: 'ADMIN' });
    prisma.userRole.upsert.mockResolvedValue({});
    prisma.userApplicationRole.upsert.mockResolvedValue({});
    prisma.user.findFirst.mockResolvedValue({ id: 'admin-1', email: 'platform.admin@iacms.gov.example' });
    prisma.user.update.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('configures iam_admin_portal with offline_access and roles in scope', async () => {
    await seedAdminPortalClient();

    const portalUpsert = prisma.oAuthClient.upsert.mock.calls.find(
      (call) => call[0]?.where?.clientId === 'iam_admin_portal'
    );

    expect(portalUpsert).toBeDefined();
    const createData = portalUpsert[0].create;
    const updateData = portalUpsert[0].update;

    expect(createData.scope).toContain('offline_access');
    expect(createData.scope).toContain('roles');
    expect(createData.scope).toContain('iam:admin');
    expect(updateData.scope).toContain('offline_access');
    expect(updateData.scope).toContain('roles');
  });

  it('restricts redirect URIs to port 5173 for 127.0.0.1 and localhost by default, configurable via env', async () => {
    await seedAdminPortalClient();

    const portalUpsert = prisma.oAuthClient.upsert.mock.calls.find(
      (call) => call[0]?.where?.clientId === 'iam_admin_portal'
    );
    expect(portalUpsert).toBeDefined();
    expect(portalUpsert[0].create.redirectUris).toEqual([
      'http://localhost:5173/auth/callback',
      'http://127.0.0.1:5173/auth/callback',
    ]);

    // Test env override
    process.env.IAM_ADMIN_PORTAL_REDIRECT_URIS = 'http://localhost:5173/auth/callback,https://admin.iacms.gov/auth/callback';
    await seedAdminPortalClient();

    const secondCall = prisma.oAuthClient.upsert.mock.calls[prisma.oAuthClient.upsert.mock.calls.length - 2];
    expect(secondCall[0].create.redirectUris).toEqual([
      'http://localhost:5173/auth/callback',
      'https://admin.iacms.gov/auth/callback',
    ]);
  });

  it('verifies by test that a refresh token is actually issued when offline_access is requested for iam_admin_portal', async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const priv = await jose.exportJWK(privateKey);
    const testJwks = { keys: [{ ...priv, use: 'sig', alg: 'RS256', kid: 'test-admin-key' }] };

    const testFindAccount = async (_ctx, sub) => ({
      accountId: sub,
      claims: async () => ({
        sub,
        email: 'platform.admin@iacms.gov.example',
        roles: ['iam-admin'],
        iam_admin: true,
      }),
    });

    const provider = new Provider('http://127.0.0.1:3001', {
      jwks: testJwks,
      cookies: { keys: ['01234567890123456789012345678901'] },
      scopes: ['openid', 'offline_access', 'profile', 'email', 'roles', 'iam:admin'],
      claims: {
        openid: ['sub'],
        profile: ['name', 'email'],
        roles: ['roles'],
      },
      routes: {
        authorization: '/oauth/authorize',
        token: '/oauth/token',
      },
      clients: [
        {
          client_id: 'iam_admin_portal',
          redirect_uris: ['http://localhost:5173/auth/callback'],
          response_types: ['code'],
          grant_types: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_method: 'none',
          scope: 'openid profile email roles iam:admin offline_access',
        },
      ],
      findAccount: testFindAccount,
      features: {
        resourceIndicators: { enabled: false },
      },
      rotateRefreshToken: true,
    });

    const testApp = express();
    testApp.post(
      '/test/finish-interaction',
      express.urlencoded({ extended: false }),
      express.json(),
      async (req, res) => {
        const grant = new provider.Grant({
          accountId: 'platform-admin-uuid-1',
          clientId: 'iam_admin_portal',
        });
        grant.addOIDCScope('openid profile roles iam:admin offline_access');
        const grantId = await grant.save();
        const result = {
          login: { accountId: 'platform-admin-uuid-1' },
          consent: { grantId },
        };
        await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
      }
    );

    testApp.use(provider.callback());

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const authRes = await request(testApp)
      .get('/oauth/authorize')
      .query({
        client_id: 'iam_admin_portal',
        response_type: 'code',
        scope: 'openid profile roles iam:admin offline_access',
        prompt: 'consent',
        redirect_uri: 'http://localhost:5173/auth/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'xyz-state-123',
      });

    // Extract interaction session from redirect
    const interactionUid = authRes.headers.location?.match(/interaction\/([a-zA-Z0-9_-]+)/)?.[1];
    expect(interactionUid).toBeDefined();

    // Finish interaction with login and consent for offline_access
    const finishRes = await request(testApp)
      .post('/test/finish-interaction')
      .set('Cookie', authRes.headers['set-cookie'] || [])
      .send();

    expect(finishRes.status).toBe(303);
    const resumePath = new URL(finishRes.headers.location).pathname;
    const cookies = [
      ...(authRes.headers['set-cookie'] || []),
      ...(finishRes.headers['set-cookie'] || []),
    ];

    const resumeRes = await request(testApp)
      .get(resumePath)
      .set('Cookie', cookies);

    console.log('resumeRes status:', resumeRes.status, 'location:', resumeRes.headers.location);
    expect(resumeRes.status).toBe(303);
    const redirectUrl = new URL(resumeRes.headers.location, 'http://localhost:5173');
    const code = redirectUrl.searchParams.get('code');
    expect(code).toBeDefined();

    // Exchange code at token endpoint
    const tokenRes = await request(testApp)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        client_id: 'iam_admin_portal',
        redirect_uri: 'http://localhost:5173/auth/callback',
        code_verifier: verifier,
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.access_token).toBeDefined();
    expect(tokenRes.body.refresh_token).toBeDefined();
    expect(tokenRes.body.token_type).toBe('Bearer');
  });
});

