import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

const { mockPrisma, mockProvider } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    oAuthClient: {
      findUnique: vi.fn(),
    },
    oAuthConsent: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  mockProvider: {
    interactionDetails: vi.fn(),
    interactionFinished: vi.fn(),
    Client: {
      find: vi.fn(),
    },
    Grant: vi.fn(),
  },
}));

vi.mock('../../src/config/database.js', () => ({
  default: mockPrisma,
}));

vi.mock('../../src/oauth/oidc.config.js', () => ({
  default: mockProvider,
}));

import {
  getInteraction,
  postLogin,
  postConsent,
  abortInteraction,
} from '../../src/oauth/interaction/interaction.controller.js';
import { ValidationError, UnauthorizedError, ForbiddenError } from '../../../../shared/common/errors.js';

describe('interaction.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      params: { uid: 'interaction-uid-123' },
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('getInteraction', () => {
    it('throws ValidationError if interaction UID mismatches req.params.uid', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'different-uid',
        params: { client_id: 'c-1' },
      });

      await getInteraction(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('returns 400 unknown_client if client does not exist', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        params: { client_id: 'c-missing' },
      });
      mockProvider.Client.find.mockResolvedValueOnce(null);

      await getInteraction(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'unknown_client' });
    });

    it('returns login prompt info when prompt is login', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        prompt: { name: 'login' },
        params: { client_id: 'c-1', scope: 'openid profile', login_hint: 'user@iacms.org' },
        session: {},
      });
      mockProvider.Client.find.mockResolvedValueOnce({ client_id: 'c-1' });

      await getInteraction(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        uid: 'interaction-uid-123',
        client_id: 'c-1',
        scope: 'openid profile',
        prompt: 'login',
        login_hint: 'user@iacms.org',
      });
    });
  });

  describe('postLogin', () => {
    it('throws ValidationError if email or password missing', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        params: { client_id: 'c-1' },
      });
      req.body = { email: 'test@iacms.org' };

      await postLogin(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('throws UnauthorizedError if password does not match', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        params: { client_id: 'c-1' },
      });
      mockProvider.Client.find.mockResolvedValueOnce({ client_id: 'c-1' });

      const hash = await bcrypt.hash('correct-pw', 10);
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        id: 'u-1',
        passwordHash: hash,
        tenant: { isActive: true },
      });

      req.body = { email: 'user@iacms.org', password: 'wrong-password' };

      await postLogin(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('enforces tenant isolation when client is tenant-scoped', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        params: { client_id: 'c-1' },
      });
      const client = {
        client_id: 'c-1',
        [Symbol.for('tenant_id')]: 'tenant-scoped-1',
      };
      mockProvider.Client.find.mockResolvedValueOnce(client);

      const hash = await bcrypt.hash('correct-pw', 10);
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        id: 'u-1',
        tenantId: 'different-tenant-2',
        passwordHash: hash,
        tenant: { isActive: true },
      });

      req.body = { email: 'user@iacms.org', password: 'correct-pw' };

      await postLogin(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('finishes interaction successfully on valid credentials and tenant match', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        params: { client_id: 'c-1' },
      });
      const client = {
        client_id: 'c-1',
        [Symbol.for('tenant_id')]: 'tenant-1',
      };
      mockProvider.Client.find.mockResolvedValueOnce(client);

      const hash = await bcrypt.hash('secret123', 10);
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        id: 'u-1',
        tenantId: 'tenant-1',
        passwordHash: hash,
        tenant: { isActive: true },
      });

      req.body = { email: 'user@iacms.org', password: 'secret123' };

      await postLogin(req, res, next);

      expect(mockProvider.interactionFinished).toHaveBeenCalledWith(
        req,
        res,
        { login: { accountId: 'u-1' } },
        { mergeWithLastSubmission: false }
      );
    });
  });

  describe('postConsent', () => {
    it('throws ValidationError if prompt is not consent', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        prompt: { name: 'login' },
      });

      await postConsent(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('grants scopes and persists consent in OAuthConsent table', async () => {
      const mockGrant = {
        addOIDCScope: vi.fn(),
        addOIDCClaims: vi.fn(),
        addResourceScope: vi.fn(),
        save: vi.fn().mockResolvedValueOnce('grant-new-id'),
      };
      mockProvider.Grant.mockImplementationOnce(() => mockGrant);

      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        prompt: {
          name: 'consent',
          details: { missingOIDCScope: ['profile', 'email'] },
        },
        session: { accountId: 'u-1' },
        params: { client_id: 'c-portal' },
      });

      mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({ id: 'c-uuid-10' });
      mockPrisma.oAuthConsent.upsert.mockResolvedValueOnce({});

      await postConsent(req, res, next);

      expect(mockGrant.addOIDCScope).toHaveBeenCalledWith('profile email');
      expect(mockGrant.save).toHaveBeenCalled();
      expect(mockPrisma.oAuthConsent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_clientId: {
              userId: 'u-1',
              clientId: 'c-uuid-10',
            },
          },
        })
      );
      expect(mockProvider.interactionFinished).toHaveBeenCalledWith(
        req,
        res,
        { consent: { grantId: 'grant-new-id' } },
        { mergeWithLastSubmission: true }
      );
    });
  });

  describe('abortInteraction', () => {
    it('finishes interaction with access_denied', async () => {
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
      });

      await abortInteraction(req, res, next);

      expect(mockProvider.interactionFinished).toHaveBeenCalledWith(
        req,
        res,
        {
          error: 'access_denied',
          error_description: 'End-User aborted interaction',
        },
        { mergeWithLastSubmission: false }
      );
    });
  });

  describe('Phase 2: HTML rendering and auto-consent', () => {
    it('renders HTML login form when request accepts html', async () => {
      req.accepts = vi.fn().mockReturnValue('html');
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        prompt: { name: 'login' },
        params: { client_id: 'c-portal', login_hint: 'user@iacms.org' },
        session: {},
      });
      mockProvider.Client.find.mockResolvedValueOnce({ client_id: 'c-portal', client_name: 'IACMS Portal' });

      await getInteraction(req, res, next);

      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('IACMS Portal'));
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<form method="POST"'));
    });

    it('auto-skips consent prompt if user already granted all requested scopes', async () => {
      const mockGrant = {
        addOIDCScope: vi.fn(),
        save: vi.fn().mockResolvedValueOnce('grant-auto-1'),
      };
      mockProvider.Grant.mockImplementationOnce(() => mockGrant);

      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        prompt: {
          name: 'consent',
          details: { missingOIDCScope: ['profile', 'email'] },
        },
        session: { accountId: 'u-user-1' },
        params: { client_id: 'c-portal' },
      });
      mockProvider.Client.find.mockResolvedValueOnce({ client_id: 'c-portal' });

      mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({ id: 'c-uuid-1' });
      mockPrisma.oAuthConsent.findUnique.mockResolvedValueOnce({
        scopes: 'openid profile email roles',
      });

      await getInteraction(req, res, next);

      expect(mockGrant.addOIDCScope).toHaveBeenCalledWith('profile email');
      expect(mockGrant.save).toHaveBeenCalled();
      expect(mockProvider.interactionFinished).toHaveBeenCalledWith(
        req,
        res,
        { consent: { grantId: 'grant-auto-1' } },
        { mergeWithLastSubmission: true }
      );
    });

    it('renders HTML consent form when request accepts html and scopes are missing', async () => {
      req.accepts = vi.fn().mockReturnValue('html');
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        prompt: {
          name: 'consent',
          details: { missingOIDCScope: ['roles'] },
        },
        session: { accountId: 'u-user-1' },
        params: { client_id: 'c-portal' },
      });
      mockProvider.Client.find.mockResolvedValueOnce({ client_id: 'c-portal', client_name: 'IACMS Portal' });
      mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce({ id: 'c-uuid-1' });
      mockPrisma.oAuthConsent.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ email: 'user@iacms.org' });

      await getInteraction(req, res, next);

      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Authorize Application'));
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('user@iacms.org'));
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('roles'));
    });

    it('re-renders HTML login form with error on invalid credentials when request accepts html', async () => {
      req.accepts = vi.fn().mockReturnValue('html');
      mockProvider.interactionDetails.mockResolvedValueOnce({
        uid: 'interaction-uid-123',
        params: { client_id: 'c-portal' },
      });
      mockProvider.Client.find.mockResolvedValue({ client_id: 'c-portal', client_name: 'IACMS Portal' });
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      req.body = { email: 'unknown@iacms.org', password: 'password123' };

      await postLogin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Invalid credentials'));
    });
  });
});
