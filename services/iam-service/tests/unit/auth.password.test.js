import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
  ttl: vi.fn(),
};

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn().mockImplementation(() => mockRedis),
  closeRedisClient: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/utils/auth.helpers.js', () => ({
  RESET_TOKEN_EXPIRES_HOURS: 24,
  getEventBus: vi.fn().mockReturnValue(null),
}));

import prisma from '../../src/config/database.js';
import { forgotPassword } from '../../src/controllers/auth/auth.password.controller.js';

describe('auth.password.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      body: {},
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.ttl.mockResolvedValue(900);
  });

  describe('forgotPassword', () => {
    it('throws ValidationError if email is missing', async () => {
      req.body = {};

      await forgotPassword(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Email is required' })
      );
    });

    it('returns generic success response even if user is not found (anti-enumeration)', async () => {
      req.body = { email: 'unknown@iacms.org' };
      prisma.user.findFirst.mockResolvedValueOnce(null);

      await forgotPassword(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    });

    it('generates token and updates user when email exists', async () => {
      req.body = { email: 'user@iacms.org' };
      prisma.user.findFirst.mockResolvedValueOnce({
        id: 'u-1',
        email: 'user@iacms.org',
        firstName: 'Tesfaye',
        isActive: true,
        tenant: { code: 'TENANT' },
      });
      prisma.user.update.mockResolvedValueOnce({});

      await forgotPassword(req, res, next);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-1' },
          data: expect.objectContaining({
            resetPasswordToken: expect.any(String),
            resetPasswordExpires: expect.any(Date),
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    });

    it('enforces rate limit and returns 429 when max attempts exceeded', async () => {
      req.body = { email: 'spam@iacms.org' };
      mockRedis.incr.mockResolvedValueOnce(6); // 6th attempt

      await forgotPassword(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
        })
      );
    });

    it('returns 429 immediately when account is locked in Redis', async () => {
      req.body = { email: 'locked@iacms.org' };
      mockRedis.get.mockResolvedValueOnce('1'); // lockout active
      mockRedis.ttl.mockResolvedValueOnce(600);

      await forgotPassword(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
        })
      );
    });
  });
});
