import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  ttl: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
};

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn().mockImplementation(() => mockRedis),
  closeRedisClient: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
  JWT_EXPIRES_IN: '24h',
  JWT_REFRESH_EXPIRES_IN: '7d',
  LOCKOUT_ATTEMPTS: 5,
  LOCKOUT_SECONDS: 900,
  getEventBus: vi.fn().mockReturnValue(null),
  generateTokens: vi.fn().mockReturnValue({
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
  }),
}));

vi.mock('../../src/utils/audit.helpers.js', () => ({
  withAuditClient: vi.fn((data) => data),
}));

import prisma from '../../src/config/database.js';
import { refreshToken, logout } from '../../src/controllers/auth/auth.session.controller.js';
import { ValidationError, UnauthorizedError } from '../../../../shared/common/errors.js';

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';

describe('auth.session.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      body: {},
      headers: {},
      user: { id: 'u-1', tenantId: 't-1' },
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
  });

  describe('refreshToken', () => {
    it('throws ValidationError if refreshToken is missing', async () => {
      req.body = {};

      await refreshToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('throws UnauthorizedError if token is blacklisted in Redis', async () => {
      const token = jwt.sign({ id: 'u-1', jti: 'jti-revoked' }, JWT_SECRET, { expiresIn: '7d' });
      req.body = { refreshToken: token };
      mockRedis.get.mockResolvedValueOnce('1'); // blacklisted

      await refreshToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('throws UnauthorizedError if user is inactive', async () => {
      const token = jwt.sign({ id: 'u-1', jti: 'jti-valid' }, JWT_SECRET, { expiresIn: '7d' });
      req.body = { refreshToken: token };
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'u-1',
        isActive: false,
        tenant: { isActive: true },
        userRoles: [],
      });

      await refreshToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('throws UnauthorizedError if tenant is inactive (Bug 5)', async () => {
      const token = jwt.sign({ id: 'u-1', jti: 'jti-valid' }, JWT_SECRET, { expiresIn: '7d' });
      req.body = { refreshToken: token };
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'u-1',
        isActive: true,
        tenant: { isActive: false },
        userRoles: [],
      });

      await refreshToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Tenant is inactive' })
      );
    });

    it('issues new token pair and blacklists old refresh token on success', async () => {
      const token = jwt.sign({ id: 'u-1', jti: 'jti-valid' }, JWT_SECRET, { expiresIn: '7d' });
      req.body = { refreshToken: token };
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'u-1',
        isActive: true,
        tenant: { isActive: true },
        userRoles: [{ roleId: 'role-1' }],
      });

      await refreshToken(req, res, next);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'auth:blacklist:jti-valid',
        '1',
        'EX',
        expect.any(Number)
      );
      expect(res.json).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });
  });

  describe('logout', () => {
    it('blacklists access token and refresh token on logout (Bug 4)', async () => {
      const accessJti = 'access-jti-123';
      const refreshJti = 'refresh-jti-456';
      const accessToken = jwt.sign({ id: 'u-1', jti: accessJti }, JWT_SECRET, { expiresIn: '1h' });
      const refreshTok = jwt.sign({ id: 'u-1', jti: refreshJti }, JWT_SECRET, { expiresIn: '7d' });

      req.headers['authorization'] = `Bearer ${accessToken}`;
      req.body = { refreshToken: refreshTok };

      await logout(req, res, next);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `auth:blacklist:${accessJti}`,
        '1',
        'EX',
        expect.any(Number)
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        `auth:blacklist:${refreshJti}`,
        '1',
        'EX',
        expect.any(Number)
      );
      expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
    });
  });
});
