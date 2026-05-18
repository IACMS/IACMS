import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../config/database.js';
import { ValidationError, NotFoundError, UnauthorizedError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import { validatePassword } from '../../utils/validators.js';
import { RESET_TOKEN_EXPIRES_HOURS, getEventBus } from '../../utils/auth.helpers.js';

const logger = new Logger('auth-service');

/**
 * POST /auth/forgot-password
 * Generates a reset token and publishes an event so notification-service sends the email.
 * Always responds with success to prevent email enumeration.
 */
export async function forgotPassword(req, res, next) {
  try {
    const { email, tenantCode } = req.body;

    if (!email) throw new ValidationError('Email is required');

    const where = { email: email.trim().toLowerCase() };
    if (tenantCode) {
      const tenant = await prisma.tenant.findUnique({ where: { code: tenantCode.trim().toUpperCase() } });
      if (tenant) where.tenantId = tenant.id;
    }

    const user = await prisma.user.findFirst({ where, include: { tenant: true } });

    const successResponse = {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };

    if (!user || !user.isActive) return res.json(successResponse);

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expires = new Date(Date.now() + RESET_TOKEN_EXPIRES_HOURS * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: resetTokenHash, resetPasswordExpires: expires },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.PASSWORD_RESET_REQUESTED, {
        email: user.email,
        firstName: user.firstName,
        resetToken,
        tenantCode: user.tenant.code,
      }).catch(err => logger.warn('Failed to publish password.reset.requested event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId: user.tenantId,
        entityType: 'user',
        entityId: user.id,
        action: 'password_reset_requested',
        userId: null,
        metadata: { email: user.email },
      }).catch(() => {});
    }

    logger.info('Password reset requested', { userId: user.id, email: user.email });
    res.json(successResponse);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/reset-password
 * Validates the reset token and sets a new password.
 */
export async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;

    if (!token) throw new ValidationError('Reset token is required');
    if (!newPassword) throw new ValidationError('New password is required');

    validatePassword(newPassword);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { gt: new Date() },
        isActive: true,
      },
      include: { tenant: true },
    });

    if (!user) throw new ValidationError('Invalid or expired password reset token. Please request a new one.');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.PASSWORD_CHANGED, { email: user.email, firstName: user.firstName })
        .catch(err => logger.warn('Failed to publish password.changed event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId: user.tenantId,
        entityType: 'user',
        entityId: user.id,
        action: 'password_reset',
        userId: null,
        metadata: { email: user.email },
      }).catch(() => {});
    }

    logger.info('Password reset successful', { userId: user.id, email: user.email });
    res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /auth/password-status
 * Returns the live `mustChangePassword` flag from the database (not the JWT snapshot).
 * No `requirePasswordChange` guard — used by the gateway for session/status and first-login flows.
 */
export async function getPasswordStatus(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError('Not authenticated');

    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { mustChangePassword: true },
    });

    res.json({ mustChangePassword: row?.mustChangePassword ?? false });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/change-password
 * Allows an authenticated user to change their own password (including forced first-login change).
 */
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword) throw new ValidationError('Current password is required');
    if (!newPassword) throw new ValidationError('New password is required');
    if (currentPassword === newPassword) throw new ValidationError('New password must be different from current password');

    validatePassword(newPassword);

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new NotFoundError('User');

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw new ValidationError('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.PASSWORD_CHANGED, { email: user.email, firstName: user.firstName })
        .catch(err => logger.warn('Failed to publish password.changed event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId: user.tenantId,
        entityType: 'user',
        entityId: user.id,
        action: 'password_changed',
        userId: user.id,
        metadata: {},
      }).catch(() => {});
    }

    logger.info('Password changed', { userId: user.id });
    res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    next(error);
  }
}
