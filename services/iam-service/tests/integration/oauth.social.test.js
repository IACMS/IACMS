import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

vi.mock('../../src/config/database.js', () => ({
  default: {
    oAuthProvider: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    role: {
      findFirst: vi.fn(),
    },
    userRole: {
      create: vi.fn(),
    },
    federatedIdentity: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/oauth/oidc.config.js', () => ({
  default: {
    interactionFinished: vi.fn((req, res, result) => res.json({ finished: true, result })),
    callback: vi.fn(() => (req, res, next) => next()),
  },
}));

vi.mock('../../src/oauth/client-secret.utils.js', () => ({
  encryptClientSecret: vi.fn((s) => `enc_${s}`),
  decryptClientSecret: vi.fn((s) => s.replace('enc_', '')),
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  generateTokens: vi.fn(() => ({
    accessToken: 'mock-jwt-access-token',
    refreshToken: 'mock-jwt-refresh-token',
  })),
  getEventBus: vi.fn(() => ({ publish: vi.fn().mockResolvedValue() })),
}));

import prisma from '../../src/config/database.js';
import socialRoutes from '../../src/oauth/social/social.routes.js';
import { createSocialState } from '../../src/oauth/social/social.service.js';

describe('OAuth2 / Social Federated Login Integration Tests (Phase 4)', () => {
  let app;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
    process.env.OIDC_ISSUER = 'http://127.0.0.1:3001';

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/auth/social', socialRoutes);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('GET /auth/social/providers returns available providers', async () => {
    prisma.oAuthProvider.findMany.mockResolvedValue([
      { provider: 'google' },
      { provider: 'github' },
    ]);

    const res = await request(app).get('/auth/social/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toContain('google');
    expect(res.body.providers).toContain('github');
  });

  it('GET /auth/social/google redirects to Google authorization URL with signed state', async () => {
    prisma.oAuthProvider.findFirst.mockResolvedValue({
      id: 'prov-g',
      provider: 'google',
      clientId: 'google-client-id-99',
      clientSecretEnc: 'enc_sec',
      scopes: ['openid', 'email', 'profile'],
    });

    const res = await request(app).get('/auth/social/google?tenant_code=TENANT_1');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);

    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.pathname).toBe('/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe('google-client-id-99');

    const stateToken = location.searchParams.get('state');
    expect(stateToken).toBeTruthy();
    const statePayload = jwt.verify(stateToken, process.env.JWT_SECRET);
    expect(statePayload.provider).toBe('google');
    expect(statePayload.tenantCode).toBe('TENANT_1');
  });

  it('GET /auth/social/google/callback performs JIT user creation and returns tokens on direct login', async () => {
    prisma.oAuthProvider.findFirst.mockResolvedValue({
      id: 'prov-g',
      provider: 'google',
      clientId: 'google-client-id-99',
      clientSecretEnc: 'enc_sec',
      scopes: ['openid', 'email', 'profile'],
    });

    prisma.oAuthProvider.findUnique.mockResolvedValue({
      id: 'prov-g',
      provider: 'google',
    });

    prisma.federatedIdentity.findUnique.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({ id: 't-1', code: 'TENANT_1', isActive: true });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue({ id: 'role-user' });

    prisma.$transaction.mockImplementation(async (cb) => {
      const tx = {
        user: {
          create: vi.fn().mockResolvedValue({
            id: 'jit-user-1',
            email: 'newuser@example.com',
            tenantId: 't-1',
            tenant: { id: 't-1', name: 'Tenant 1', code: 'TENANT_1' },
          }),
        },
        userRole: { create: vi.fn().mockResolvedValue({}) },
        federatedIdentity: { create: vi.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    });

    prisma.user.findUnique.mockResolvedValue({
      id: 'jit-user-1',
      email: 'newuser@example.com',
      firstName: 'New',
      lastName: 'User',
      tenant: { id: 't-1', name: 'Tenant 1', code: 'TENANT_1' },
      userRoles: [{ roleId: 'role-user' }],
    });

    // Mock upstream Google endpoints
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'goog-at' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'goog-sub-1',
          email: 'newuser@example.com',
          email_verified: true,
          given_name: 'New',
          family_name: 'User',
        }),
      });

    const state = createSocialState({
      provider: 'google',
      tenantCode: 'TENANT_1',
      interactionUid: null,
    });

    const res = await request(app)
      .get('/auth/social/google/callback')
      .query({ code: 'auth-code-123', state });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('mock-jwt-access-token');
    expect(res.body.refreshToken).toBe('mock-jwt-refresh-token');
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user.email).toBe('newuser@example.com');
  });

  it('GET /auth/social/google/callback bridges to OIDC interaction when interactionUid is present', async () => {
    prisma.oAuthProvider.findFirst.mockResolvedValue({
      id: 'prov-g',
      provider: 'google',
      clientId: 'google-client-id-99',
      clientSecretEnc: 'enc_sec',
      scopes: ['openid', 'email', 'profile'],
    });

    prisma.oAuthProvider.findUnique.mockResolvedValue({
      id: 'prov-g',
      provider: 'google',
    });

    // Existing identity
    prisma.federatedIdentity.findUnique.mockResolvedValue({
      id: 'fed-1',
      user: {
        id: 'user-oidc-bridge-99',
        email: 'alex@iacms.org',
        isActive: true,
        tenant: { isActive: true },
        userRoles: [{ roleId: 'r-1' }],
      },
    });

    prisma.user.update.mockResolvedValue({});

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'goog-at' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'goog-sub-existing',
          email: 'alex@iacms.org',
          email_verified: true,
        }),
      });

    const state = createSocialState({
      provider: 'google',
      interactionUid: 'interaction-oidc-123',
    });

    const res = await request(app)
      .get('/auth/social/google/callback')
      .query({ code: 'valid-google-code', state });

    expect(res.status).toBe(200);
    expect(res.body.finished).toBe(true);
    expect(res.body.result).toEqual({ login: { accountId: 'user-oidc-bridge-99' } });
  });
});
