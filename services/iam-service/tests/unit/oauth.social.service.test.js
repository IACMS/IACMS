import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getProviderConfig,
  getActiveProviders,
  createSocialState,
  verifySocialState,
  buildAuthorizationUrl,
  exchangeCodeAndFetchProfile,
  resolveTenant,
  processSocialLogin,
  unlinkSocialProvider,
  listUserIdentities,
} from '../../src/oauth/social/social.service.js';
import prisma from '../../src/config/database.js';

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

vi.mock('../../src/oauth/client-secret.utils.js', () => ({
  encryptClientSecret: vi.fn((plain) => `enc_${plain}`),
  decryptClientSecret: vi.fn((cipher) => cipher.replace(/^enc_/, '')),
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn().mockResolvedValue() })),
}));

describe('social.service unit tests', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  describe('getProviderConfig', () => {
    it('resolves provider from database with decrypted secret', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'prov-1',
        provider: 'google',
        clientId: 'g-client-123',
        clientSecretEnc: 'enc_secret456',
        scopes: ['openid', 'email'],
        config: {},
      });

      const config = await getProviderConfig('google');
      expect(config.clientId).toBe('g-client-123');
      expect(config.clientSecret).toBe('secret456');
      expect(config.isFromDb).toBe(true);
    });

    it('falls back to environment variables when DB record is absent', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue(null);
      process.env.GOOGLE_CLIENT_ID = 'env-google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'env-google-sec';

      const config = await getProviderConfig('google');
      expect(config.clientId).toBe('env-google-id');
      expect(config.clientSecret).toBe('env-google-sec');
      expect(config.isFromDb).toBe(false);
    });

    it('throws NotFoundError when provider is unconfigured', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue(null);
      await expect(getProviderConfig('github')).rejects.toThrow(/not configured or active/i);
    });
  });

  describe('state signing & verification', () => {
    it('creates and verifies signed state JWT', () => {
      const payload = { provider: 'google', interactionUid: 'uid-abc', tenantCode: 'ACME' };
      const token = createSocialState(payload);

      expect(typeof token).toBe('string');
      const decoded = verifySocialState(token);

      expect(decoded.provider).toBe('google');
      expect(decoded.interactionUid).toBe('uid-abc');
      expect(decoded.tenantCode).toBe('ACME');
      expect(decoded.nonce).toBeTruthy();
    });

    it('rejects tampered or malformed state', () => {
      expect(() => verifySocialState('invalid-token')).toThrow(/Invalid or expired state/i);
      expect(() => verifySocialState('')).toThrow(/Missing state/i);
    });
  });

  describe('buildAuthorizationUrl', () => {
    it('builds Google authorization URL with prompt=select_account', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'prov-g',
        provider: 'google',
        clientId: 'g-client-id',
        clientSecretEnc: 'enc_s',
        scopes: ['openid', 'email', 'profile'],
      });

      const urlStr = await buildAuthorizationUrl('google', {
        statePayload: { provider: 'google' },
        redirectUri: 'http://localhost:3001/auth/social/google/callback',
      });

      const url = new URL(urlStr);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('g-client-id');
      expect(url.searchParams.get('prompt')).toBe('select_account');
      expect(url.searchParams.get('state')).toBeTruthy();
    });

    it('builds Microsoft authorization URL with custom tenant ID if configured', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'prov-ms',
        provider: 'microsoft',
        clientId: 'ms-client-id',
        clientSecretEnc: 'enc_s',
        scopes: ['openid', 'email'],
        config: { microsoftTenantId: 'tenant-guid-123' },
      });

      const urlStr = await buildAuthorizationUrl('microsoft', {
        statePayload: { provider: 'microsoft' },
        redirectUri: 'http://localhost:3001/auth/social/microsoft/callback',
      });

      const url = new URL(urlStr);
      expect(url.origin).toBe('https://login.microsoftonline.com');
      expect(url.pathname).toBe('/tenant-guid-123/oauth2/v2.0/authorize');
    });

    it('builds GitHub authorization URL', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'prov-gh',
        provider: 'github',
        clientId: 'gh-client-id',
        clientSecretEnc: 'enc_s',
        scopes: ['read:user', 'user:email'],
      });

      const urlStr = await buildAuthorizationUrl('github', {
        statePayload: { provider: 'github' },
        redirectUri: 'http://localhost:3001/auth/social/github/callback',
      });

      const url = new URL(urlStr);
      expect(url.origin).toBe('https://github.com');
      expect(url.pathname).toBe('/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('gh-client-id');
    });
  });

  describe('exchangeCodeAndFetchProfile (Security Rules 2 & 3)', () => {
    it('Google: successfully fetches profile when email_verified is true', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'p-1',
        provider: 'google',
        clientId: 'g-id',
        clientSecretEnc: 'enc_sec',
        scopes: [],
      });

      const mockFetch = vi.fn()
        // 1. Token exchange response
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'g-access-token' }),
        })
        // 2. UserInfo response
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sub: 'google-sub-999',
            email: 'user@gmail.com',
            email_verified: true,
            given_name: 'John',
            family_name: 'Doe',
          }),
        });
      globalThis.fetch = mockFetch;

      const profile = await exchangeCodeAndFetchProfile('google', {
        code: 'valid-code',
        redirectUri: 'http://localhost/callback',
      });

      expect(profile.provider).toBe('google');
      expect(profile.externalId).toBe('google-sub-999');
      expect(profile.email).toBe('user@gmail.com');
      expect(profile.emailVerified).toBe(true);
      expect(profile.firstName).toBe('John');
    });

    it('Google: rejects profile when email_verified is false (Security Rule 2)', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'p-1',
        provider: 'google',
        clientId: 'g-id',
        clientSecretEnc: 'enc_sec',
        scopes: [],
      });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'g-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            sub: 'sub-unverified',
            email: 'fake@gmail.com',
            email_verified: false,
          }),
        });
      globalThis.fetch = mockFetch;

      await expect(
        exchangeCodeAndFetchProfile('google', { code: 'code', redirectUri: 'http://cb' })
      ).rejects.toThrow(/email is not verified/i);
    });

    it('GitHub: verifies primary email from /user/emails (Security Rule 3)', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'p-gh',
        provider: 'github',
        clientId: 'gh-id',
        clientSecretEnc: 'enc_sec',
        scopes: [],
      });

      const mockFetch = vi.fn()
        // 1. Token exchange
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'gh-token' }),
        })
        // 2. /user
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 123456, login: 'octocat', name: 'Octo Cat' }),
        })
        // 3. /user/emails
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { email: 'secondary@github.com', primary: false, verified: true },
            { email: 'octocat@github.com', primary: true, verified: true },
          ],
        });
      globalThis.fetch = mockFetch;

      const profile = await exchangeCodeAndFetchProfile('github', {
        code: 'gh-code',
        redirectUri: 'http://cb',
      });

      expect(profile.externalId).toBe('123456');
      expect(profile.email).toBe('octocat@github.com');
      expect(profile.firstName).toBe('Octo');
    });

    it('GitHub: rejects when no primary verified email is found (Security Rule 3)', async () => {
      prisma.oAuthProvider.findFirst.mockResolvedValue({
        id: 'p-gh',
        provider: 'github',
        clientId: 'gh-id',
        clientSecretEnc: 'enc_sec',
        scopes: [],
      });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'gh-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 123456, login: 'unverified' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { email: 'unverified@github.com', primary: true, verified: false },
          ],
        });
      globalThis.fetch = mockFetch;

      await expect(
        exchangeCodeAndFetchProfile('github', { code: 'c', redirectUri: 'http://cb' })
      ).rejects.toThrow(/verified primary email/i);
    });
  });

  describe('resolveTenant (Security Rule 5)', () => {
    it('resolves tenant by tenantCode', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't-1', code: 'POLICE', isActive: true });

      const tenant = await resolveTenant({ tenantCode: 'POLICE', email: 'test@example.com' });
      expect(tenant.id).toBe('t-1');
    });

    it('resolves tenant from email domain if registered in tenant.config.domains', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't-1', code: 'MOJ', isActive: true, config: { domains: ['justice.gov'] } },
        { id: 't-2', code: 'MOD', isActive: true, config: { domains: ['defense.gov'] } },
      ]);

      const tenant = await resolveTenant({ email: 'officer@justice.gov' });
      expect(tenant.id).toBe('t-1');
    });

    it('rejects if email domain is unregistered and tenant_code is missing', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't-1', code: 'MOJ', isActive: true, config: { domains: ['justice.gov'] } },
      ]);

      await expect(resolveTenant({ email: 'user@randomdomain.com' })).rejects.toThrow(
        /Could not resolve organization/i
      );
    });
  });

  describe('processSocialLogin (JIT Provisioning & Account Takeover Prevention)', () => {
    it('Flow 1 (Explicit link): links provider to authenticated user account', async () => {
      prisma.oAuthProvider.findUnique.mockResolvedValue({ id: 'prov-uuid-1', provider: 'google' });
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.federatedIdentity.create.mockResolvedValue({ id: 'fed-1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-auth-123', email: 'me@iacms.org', tenant: { code: 'T1' } });

      const result = await processSocialLogin({
        profile: { provider: 'google', providerId: 'prov-uuid-1', externalId: 'ext-99', email: 'me@iacms.org' },
        state: { action: 'link', userId: 'user-auth-123' },
      });

      expect(result.linked).toBe(true);
      expect(prisma.federatedIdentity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-auth-123',
            providerId: 'prov-uuid-1',
            externalId: 'ext-99',
          }),
        })
      );
    });

    it('Flow 2 (Existing identity): logs in user when identity is already linked', async () => {
      prisma.oAuthProvider.findUnique.mockResolvedValue({ id: 'prov-uuid-1', provider: 'google' });
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        id: 'fed-1',
        user: { id: 'u-1', isActive: true, tenant: { isActive: true }, userRoles: [{ roleId: 'role-1' }] },
      });
      prisma.user.update.mockResolvedValue({});

      const result = await processSocialLogin({
        profile: { provider: 'google', providerId: 'prov-uuid-1', externalId: 'ext-1' },
        state: { action: 'login' },
      });

      expect(result.user.id).toBe('u-1');
      expect(result.isNew).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u-1' } })
      );
    });

    it('Flow 3 (Conflict Guard): rejects social login if account with email exists but is unlinked (Security Rule 4)', async () => {
      prisma.oAuthProvider.findUnique.mockResolvedValue({ id: 'prov-uuid-1', provider: 'google' });
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't-1', code: 'POLICE', isActive: true });
      prisma.user.findFirst.mockResolvedValue({ id: 'existing-u', email: 'victim@iacms.org' });

      await expect(
        processSocialLogin({
          profile: {
            provider: 'google',
            providerId: 'prov-uuid-1',
            externalId: 'attacker-ext-id',
            email: 'victim@iacms.org',
          },
          state: { action: 'login', tenantCode: 'POLICE' },
        })
      ).rejects.toThrow(/An account with this email address already exists/i);
    });

    it('Flow 3 (JIT Provisioning): provisions new user + default role + federated identity', async () => {
      prisma.oAuthProvider.findUnique.mockResolvedValue({ id: 'prov-uuid-1', provider: 'google' });
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't-1', code: 'POLICE', isActive: true });
      prisma.user.findFirst.mockResolvedValue(null); // No existing email or username conflict
      prisma.role.findFirst.mockResolvedValue({ id: 'role-default', name: 'operator' });

      // Simulate transaction
      prisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'new-user-1',
              email: 'newuser@police.gov',
              tenantId: 't-1',
              tenant: { code: 'POLICE' },
            }),
          },
          userRole: { create: vi.fn().mockResolvedValue({}) },
          federatedIdentity: { create: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      prisma.user.findUnique.mockResolvedValue({
        id: 'new-user-1',
        email: 'newuser@police.gov',
        tenant: { code: 'POLICE' },
        userRoles: [{ roleId: 'role-default' }],
      });

      const result = await processSocialLogin({
        profile: {
          provider: 'google',
          providerId: 'prov-uuid-1',
          externalId: 'goog-new-123',
          email: 'newuser@police.gov',
          firstName: 'Alice',
          lastName: 'Smith',
        },
        state: { action: 'login', tenantCode: 'POLICE' },
      });

      expect(result.isNew).toBe(true);
      expect(result.user.id).toBe('new-user-1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('unlinkSocialProvider', () => {
    it('unlinks identity when user has multiple login methods', async () => {
      prisma.federatedIdentity.findFirst.mockResolvedValue({ id: 'fed-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        federatedIdentities: [{ id: 'fed-1' }, { id: 'fed-2' }],
        mustChangePassword: false,
      });
      prisma.federatedIdentity.delete.mockResolvedValue({});

      const result = await unlinkSocialProvider('u-1', 'google');
      expect(result.message).toMatch(/successfully unlinked/i);
      expect(prisma.federatedIdentity.delete).toHaveBeenCalledWith({ where: { id: 'fed-1' } });
    });

    it('rejects unlinking if it is the only login method and user has no password', async () => {
      prisma.federatedIdentity.findFirst.mockResolvedValue({ id: 'fed-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        federatedIdentities: [{ id: 'fed-1' }],
        mustChangePassword: true, // cannot login via password
      });

      await expect(unlinkSocialProvider('u-1', 'google')).rejects.toThrow(
        /Cannot unlink the only authentication method/i
      );
    });
  });
});
