import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initiateAuth,
  handleCallback,
  linkProvider,
  unlinkProvider,
  getLinkedProviders,
  getAvailableProviders,
} from '../../src/oauth/social/social.controller.js';
import * as socialService from '../../src/oauth/social/social.service.js';
import providerInstance from '../../src/oauth/oidc.config.js';

vi.mock('../../src/oauth/social/social.service.js', () => ({
  buildAuthorizationUrl: vi.fn(),
  exchangeCodeAndFetchProfile: vi.fn(),
  processSocialLogin: vi.fn(),
  verifySocialState: vi.fn(),
  unlinkSocialProvider: vi.fn(),
  listUserIdentities: vi.fn(),
  getActiveProviders: vi.fn(),
}));

vi.mock('../../src/oauth/oidc.config.js', () => ({
  default: {
    interactionFinished: vi.fn(),
  },
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  generateTokens: vi.fn().mockReturnValue({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  }),
}));

describe('social.controller unit tests', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      params: {},
      query: {},
      body: {},
      headers: {},
      accepts: vi.fn().mockReturnValue(true),
      protocol: 'http',
      get: vi.fn().mockReturnValue('localhost:3001'),
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('initiateAuth', () => {
    it('redirects to built authorization URL', async () => {
      req.params.provider = 'google';
      req.query = { interaction: 'uid-123', tenant_code: 'POLICE' };
      socialService.buildAuthorizationUrl.mockResolvedValue('https://accounts.google.com/auth-url');

      await initiateAuth(req, res, next);

      expect(socialService.buildAuthorizationUrl).toHaveBeenCalledWith(
        'google',
        expect.objectContaining({
          statePayload: expect.objectContaining({
            provider: 'google',
            interactionUid: 'uid-123',
            tenantCode: 'POLICE',
          }),
        })
      );
      expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.com/auth-url');
    });

    it('rejects unsupported provider name', async () => {
      req.params.provider = 'unsupported_idp';
      await initiateAuth(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('handleCallback', () => {
    it('bridges back to OIDC interaction when interactionUid is present in state', async () => {
      req.params.provider = 'google';
      req.query = { code: 'auth-code-123', state: 'signed-state-jwt' };

      socialService.verifySocialState.mockReturnValue({
        provider: 'google',
        interactionUid: 'interaction-uid-789',
      });

      socialService.exchangeCodeAndFetchProfile.mockResolvedValue({
        provider: 'google',
        externalId: 'ext-1',
        email: 'user@gmail.com',
      });

      socialService.processSocialLogin.mockResolvedValue({
        user: { id: 'user-guid-99' },
        isNew: false,
      });

      await handleCallback(req, res, next);

      expect(providerInstance.interactionFinished).toHaveBeenCalledWith(
        req,
        res,
        { login: { accountId: 'user-guid-99' } },
        { mergeWithLastSubmission: false }
      );
    });

    it('returns internal tokens when logging in via direct API flow', async () => {
      req.params.provider = 'github';
      req.query = { code: 'gh-code', state: 'valid-state' };

      socialService.verifySocialState.mockReturnValue({
        provider: 'github',
        interactionUid: null,
      });

      socialService.exchangeCodeAndFetchProfile.mockResolvedValue({
        provider: 'github',
        externalId: 'gh-99',
        email: 'dev@github.com',
      });

      socialService.processSocialLogin.mockResolvedValue({
        user: {
          id: 'u-1',
          email: 'dev@github.com',
          firstName: 'Dev',
          lastName: 'Ops',
          tenant: { id: 't-1', name: 'IT', code: 'IT_DEPT' },
          userRoles: [{ roleId: 'role-dev' }],
        },
        isNew: true,
      });

      await handleCallback(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          isNewUser: true,
          user: expect.objectContaining({ id: 'u-1', email: 'dev@github.com' }),
        })
      );
    });

    it('redirects with clientRedirectUri when present', async () => {
      req.params.provider = 'microsoft';
      req.query = { code: 'ms-code', state: 'valid-state' };

      socialService.verifySocialState.mockReturnValue({
        provider: 'microsoft',
        clientRedirectUri: 'https://portal.iacms.local/auth-callback',
      });

      socialService.exchangeCodeAndFetchProfile.mockResolvedValue({
        provider: 'microsoft',
        externalId: 'ms-1',
        email: 'ms@corp.com',
      });

      socialService.processSocialLogin.mockResolvedValue({
        user: { id: 'u-1', email: 'ms@corp.com', tenant: { id: 't-1' } },
      });

      await handleCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('https://portal.iacms.local/auth-callback?access_token=')
      );
    });

    it('rejects upstream provider error', async () => {
      req.params.provider = 'google';
      req.query = { error: 'access_denied', error_description: 'User denied consent' };

      await handleCallback(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('linkProvider & unlinkProvider', () => {
    it('linkProvider builds authorization URL with action=link', async () => {
      req.params.provider = 'github';
      req.headers['x-user-id'] = 'user-logged-in-1';
      socialService.buildAuthorizationUrl.mockResolvedValue('https://github.com/login/oauth/authorize?state=...');

      await linkProvider(req, res, next);

      expect(socialService.buildAuthorizationUrl).toHaveBeenCalledWith(
        'github',
        expect.objectContaining({
          statePayload: expect.objectContaining({
            action: 'link',
            userId: 'user-logged-in-1',
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({ redirectUrl: expect.any(String) });
    });

    it('unlinkProvider unlinks provider for user', async () => {
      req.params.provider = 'google';
      req.headers['x-user-id'] = 'user-1';
      socialService.unlinkSocialProvider.mockResolvedValue({ message: 'google account successfully unlinked' });

      await unlinkProvider(req, res, next);

      expect(socialService.unlinkSocialProvider).toHaveBeenCalledWith('user-1', 'google');
      expect(res.json).toHaveBeenCalledWith({ message: 'google account successfully unlinked' });
    });
  });

  describe('getLinkedProviders & getAvailableProviders', () => {
    it('getLinkedProviders returns list of identities', async () => {
      req.headers['x-user-id'] = 'user-1';
      socialService.listUserIdentities.mockResolvedValue([{ provider: 'google', email: 'u@gmail.com' }]);

      await getLinkedProviders(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        identities: [{ provider: 'google', email: 'u@gmail.com' }],
      });
    });

    it('getAvailableProviders returns list of active providers', async () => {
      socialService.getActiveProviders.mockResolvedValue(['google', 'microsoft']);

      await getAvailableProviders(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ providers: ['google', 'microsoft'] });
    });
  });
});

