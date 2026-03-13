import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { ValidationError, UnauthorizedError, NotFoundError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';
import EventBus from '../../../../shared/utils/eventBus.js';
import { validateLoginRequest, validateRegisterRequest, validateCreateUserRequest } from '../utils/validators.js';
import { sendWelcomeEmail, sendPasswordResetEmail, sendPasswordChangedEmail } from '../utils/email.js';

const logger = new Logger('auth-service');
let eventBus = null;

// Initialize event bus lazily (allows service to start if Kafka is not yet ready)
function getEventBus() {
  if (!eventBus) {
    try {
      eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'auth-service');
    } catch (error) {
      logger.warn('Failed to connect to Kafka event bus', { error: error.message });
    }
  }
  return eventBus;
}

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const RESET_TOKEN_EXPIRES_HOURS = 1;

/**
 * Generate a random temporary password: 4 letters + 4 digits + 4 special chars
 * Result is always 12 characters long and satisfies the PASSWORD_REGEX.
 */
function generateTemporaryPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const specials = '@$!%*#?&';
  const rand = (str) => str[crypto.randomInt(str.length)];
  const parts = [
    rand(letters), rand(letters), rand(letters), rand(letters),
    rand(digits),  rand(digits),  rand(digits),  rand(digits),
    rand(specials), rand(specials),
    rand(letters), rand(digits),
  ];
  // Fisher-Yates shuffle
  for (let i = parts.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }
  return parts.join('');
}

/**
 * Generate JWT tokens
 */
function generateTokens(user) {
  const payload = {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  });

  return { accessToken, refreshToken };
}

/**
 * Login
 */
export async function login(req, res, next) {
  try {
    // Validate input
    const { email, password, tenantCode } = validateLoginRequest(req.body);

    if (!password) {
      throw new ValidationError('Password is required');
    }

    // Find tenant if tenantCode provided
    let tenant = null;
    if (tenantCode) {
      tenant = await prisma.tenant.findUnique({
        where: { code: tenantCode },
      });
      if (!tenant) {
        throw new NotFoundError('Tenant');
      }
      if (!tenant.isActive) {
        throw new UnauthorizedError('Tenant is inactive');
      }
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        email,
        ...(tenant && { tenantId: tenant.id }),
      },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedError('Account is inactive');
    }

    // Check if tenant is active
    if (!user.tenant.isActive) {
      throw new UnauthorizedError('Tenant is inactive');
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Publish event (non-blocking)
    const bus = getEventBus();
    if (bus) {
      bus.publish('user.logged_in', {
        userId: user.id,
        tenantId: user.tenantId,
      }).catch(err => logger.warn('Failed to publish login event', { error: err.message }));
    }

    logger.info('User logged in', { userId: user.id, tenantId: user.tenantId });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          code: user.tenant.code,
        },
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Register
 */
export async function register(req, res, next) {
  try {
    // Validate input - accepts either tenantCode or tenantId
    const { email, password, firstName, lastName, tenantId, tenantCode, username } = validateRegisterRequest(req.body);

    // Find tenant by code or ID
    let tenant;
    if (tenantCode) {
      tenant = await prisma.tenant.findUnique({
        where: { code: tenantCode },
      });
    } else if (tenantId) {
      tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });
    }

    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    if (!tenant.isActive) {
      throw new ValidationError('Cannot register with inactive tenant');
    }

    // Check if user exists (by email)
    const existingUser = await prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [
          { email },
          ...(username ? [{ username }] : []),
        ],
      },
    });

    if (existingUser) {
      if (existingUser.email === email) {
        throw new ValidationError('User with this email already exists in this organization');
      }
      if (username && existingUser.username === username) {
        throw new ValidationError('Username is already taken in this organization');
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        username: username || email.split('@')[0],
        passwordHash,
        firstName,
        lastName,
        tenantId: tenant.id,
      },
      include: {
        tenant: true,
      },
    });

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Publish event (non-blocking)
    const bus = getEventBus();
    if (bus) {
      bus.publish('user.created', {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
      }).catch(err => logger.warn('Failed to publish user.created event', { error: err.message }));
    }

    logger.info('User registered', { userId: user.id, tenantId: user.tenantId, email: user.email });

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          code: user.tenant.code,
        },
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Refresh token
 */
export async function refreshToken(req, res, next) {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      throw new ValidationError('Refresh token is required');
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { tenant: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid token');
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Logout
 */
export async function logout(req, res, next) {
  try {
    // In a production system, you might want to blacklist the token
    // For now, we'll just return success
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user profile
 */
export async function getProfile(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: true,
        lastLogin: true,
        createdAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin: Create a new user account and send welcome email with temporary password.
 * The requesting admin must be authenticated (x-user-id header set by gateway).
 */
export async function createUser(req, res, next) {
  try {
    const { email, firstName, lastName, username, tenantCode, tenantId } = validateCreateUserRequest(req.body);

    // Resolve tenant
    let tenant;
    if (tenantCode) {
      tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
    } else {
      tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    }

    if (!tenant) throw new NotFoundError('Tenant');
    if (!tenant.isActive) throw new ValidationError('Cannot create user for inactive tenant');

    // Check for duplicates
    const existing = await prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [{ email }, ...(username ? [{ username }] : [])],
      },
    });
    if (existing) {
      if (existing.email === email) throw new ValidationError('A user with this email already exists in this organization');
      throw new ValidationError('Username is already taken in this organization');
    }

    // Generate temporary password
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    // Create user — inactive until they first log in and change password
    const user = await prisma.user.create({
      data: {
        email,
        username: username || email.split('@')[0],
        passwordHash,
        firstName,
        lastName,
        tenantId: tenant.id,
        isActive: true,
        mustChangePassword: true,
      },
      include: { tenant: true },
    });

    // Send welcome email (non-blocking — don't fail user creation if email fails)
    sendWelcomeEmail({
      to: email,
      firstName,
      tenantName: tenant.name,
      temporaryPassword,
    }).catch(err => logger.warn('Welcome email failed', { error: err.message }));

    // Publish event
    const bus = getEventBus();
    if (bus) {
      bus.publish('user.created', {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        createdBy: req.headers['x-user-id'],
      }).catch(err => logger.warn('Failed to publish user.created event', { error: err.message }));
    }

    logger.info('Admin created user', { userId: user.id, tenantId: user.tenantId, email: user.email });

    res.status(201).json({
      message: 'User created. A welcome email with their temporary password has been sent.',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        mustChangePassword: user.mustChangePassword,
        tenant: { id: user.tenant.id, name: user.tenant.name, code: user.tenant.code },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Forgot password — generate reset token and send email.
 * Public endpoint (no auth required).
 */
export async function forgotPassword(req, res, next) {
  try {
    const { email, tenantCode } = req.body;

    if (!email) throw new ValidationError('Email is required');

    // Build where clause
    const where = { email: email.trim().toLowerCase() };
    if (tenantCode) {
      const tenant = await prisma.tenant.findUnique({ where: { code: tenantCode.trim().toUpperCase() } });
      if (tenant) where.tenantId = tenant.id;
    }

    const user = await prisma.user.findFirst({
      where,
      include: { tenant: true },
    });

    // Always respond with success to prevent email enumeration
    const successResponse = {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };

    if (!user || !user.isActive) {
      return res.json(successResponse);
    }

    // Generate a cryptographically secure token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expires = new Date(Date.now() + RESET_TOKEN_EXPIRES_HOURS * 60 * 60 * 1000);

    // Store hashed token (never store plain tokens in DB)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: expires,
      },
    });

    // Send email with the plain token (user pastes it in the reset form)
    sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetToken,
      tenantCode: user.tenant.code,
    }).catch(err => logger.warn('Reset email failed', { error: err.message }));

    logger.info('Password reset requested', { userId: user.id, email: user.email });
    res.json(successResponse);
  } catch (error) {
    next(error);
  }
}

/**
 * Reset password — validate token and set new password.
 * Public endpoint (no auth required).
 */
export async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;

    if (!token) throw new ValidationError('Reset token is required');
    if (!newPassword) throw new ValidationError('New password is required');

    // Validate password strength
    const { validatePassword } = await import('../utils/validators.js');
    validatePassword(newPassword);

    // Hash the incoming token and look it up
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { gt: new Date() }, // not expired
        isActive: true,
      },
      include: { tenant: true },
    });

    if (!user) {
      throw new ValidationError('Invalid or expired password reset token. Please request a new one.');
    }

    // Update password and clear reset fields
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

    // Notify user
    sendPasswordChangedEmail({
      to: user.email,
      firstName: user.firstName,
    }).catch(err => logger.warn('Password changed email failed', { error: err.message }));

    logger.info('Password reset successful', { userId: user.id, email: user.email });
    res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (error) {
    next(error);
  }
}

/**
 * Change password — for authenticated users (including forced change on first login).
 * Requires valid JWT.
 */
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword) throw new ValidationError('Current password is required');
    if (!newPassword) throw new ValidationError('New password is required');
    if (currentPassword === newPassword) throw new ValidationError('New password must be different from current password');

    const { validatePassword } = await import('../utils/validators.js');
    validatePassword(newPassword);

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new NotFoundError('User');

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw new ValidationError('Current password is incorrect');

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
    });

    // Notify user
    sendPasswordChangedEmail({
      to: user.email,
      firstName: user.firstName,
    }).catch(err => logger.warn('Password changed email failed', { error: err.message }));

    logger.info('Password changed', { userId: user.id });
    res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    next(error);
  }
}

