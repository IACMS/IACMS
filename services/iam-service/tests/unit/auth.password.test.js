import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        firstName: 'Bekele',
        isActive: true,
        tenantId: 't-1',
        tenant: { code: 'DCS01' },
      });
      prisma.user.update.mockResolvedValueOnce({ id: 'u-1' });

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
  });
});
