import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../config/database.js';
import { ValidationError, NotFoundError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import { getEventBus, generateTokens, generateTemporaryPassword } from '../../utils/auth.helpers.js';
import { validateRegisterRequest, validateCreateUserRequest } from '../../utils/validators.js';

const logger = new Logger('auth-service');

/**
 * POST /auth/register
 * Public self-registration — creates a user and immediately issues tokens.
 * firstName and lastName are required. New accounts use mustChangePassword so the client
 * must prompt for a new password before other protected routes work.
 */
export async function register(req, res, next) {
  try {
    const { email, password, firstName, lastName, tenantId, tenantCode, username } = validateRegisterRequest(req.body);

    // Resolve tenant by code or ID
    let tenant;
    if (tenantCode) {
      tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
    } else if (tenantId) {
      tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    }

    if (!tenant) throw new NotFoundError('Tenant');
    if (!tenant.isActive) throw new ValidationError('Cannot register with inactive tenant');

    // Duplicate check
    const existing = await prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [{ email }, ...(username ? [{ username }] : [])],
      },
    });
    if (existing) {
      if (existing.email === email) throw new ValidationError('User with this email already exists in this organization');
      if (username && existing.username === username) throw new ValidationError('Username is already taken in this organization');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        username: username || email.split('@')[0],
        passwordHash,
        firstName,
        lastName,
        tenantId: tenant.id,
        mustChangePassword: true,
      },
      include: { tenant: true },
    });

    // Generate email verification token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: tokenHash, emailVerificationExpires: tokenExpires },
    });

    const { accessToken, refreshToken } = generateTokens(user, []);

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_CREATED, {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        source: 'register',
      }).catch(err => logger.warn('Failed to publish user.created event', { error: err.message }));

      bus.publish(TOPICS.EMAIL_VERIFICATION_REQUESTED, {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        verificationToken: rawToken,
        tenantCode: tenant.code,
      }).catch(err => logger.warn('Failed to publish email.verification.requested event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId: user.tenantId,
        entityType: 'user',
        entityId: user.id,
        action: 'user_registered',
        userId: user.id,
        metadata: { email: user.email },
      }).catch(() => {});
    }

    logger.info('User registered', { userId: user.id, tenantId: user.tenantId, email: user.email });

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isEmailVerified: false,
        mustChangePassword: true,
        tenant: { id: user.tenant.id, name: user.tenant.name, code: user.tenant.code },
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/verify-email
 * Public endpoint — verifies a user's email using the token sent during registration.
 * Body: { token }
 */
export async function verifyEmail(req, res, next) {
  try {
    const { token } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'Verification token is required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: tokenHash,
        emailVerificationExpires: { gt: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    });

    logger.info('Email verified', { userId: user.id, email: user.email });

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/resend-verification
 * Authenticated endpoint — re-generates the verification token and re-publishes the event.
 * Useful if the original email expired or was not received.
 */
export async function resendVerification(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { tenant: true } });

    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: tokenHash, emailVerificationExpires: tokenExpires },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.EMAIL_VERIFICATION_REQUESTED, {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        verificationToken: rawToken,
        tenantCode: user.tenant.code,
      }).catch(err => logger.warn('Failed to publish email.verification.requested event', { error: err.message }));
    }

    logger.info('Verification email resent', { userId: user.id, email: user.email });

    res.json({ message: 'Verification email resent. Please check your inbox.' });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/users/create
 * Admin creates a user with a temporary password. Sends welcome email via Kafka.
 */
export async function createUser(req, res, next) {
  try {
    const actorTenantId = req.headers['x-tenant-id'] || req.user?.tenantId;
    const { email, firstName, lastName, username, tenantCode, tenantId, roleId } = validateCreateUserRequest(
      req.body,
      actorTenantId,
    );

    // Resolve tenant
    let tenant;
    if (tenantCode) {
      tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
    } else {
      tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    }

    if (!tenant) throw new NotFoundError('Tenant');
    if (actorTenantId && tenant.id !== actorTenantId) {
      throw new ValidationError('Cannot create users for another organization');
    }
    if (!tenant.isActive) throw new ValidationError('Cannot create user for inactive tenant');

    // Duplicate check
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

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

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

    // Assign role if provided
    let assignedRole = null;
    if (roleId) {
      const role = await prisma.role.findFirst({ where: { id: roleId, isActive: true } });
      if (!role) throw new NotFoundError('Role');
      await prisma.userRole.create({
        data: { userId: user.id, roleId, assignedBy: req.headers['x-user-id'] || null },
      });
      assignedRole = { id: role.id, name: role.name };
    }

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_CREATED, {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName,
        tenantName: tenant.name,
        tenantCode: tenant.code,
        temporaryPassword,
        source: 'admin',
        createdBy: req.headers['x-user-id'] || null,
      }).catch(err => logger.warn('Failed to publish user.created event', { error: err.message }));
    }

    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId: user.tenantId,
        entityType: 'user',
        entityId: user.id,
        action: 'user_created_by_admin',
        userId: req.headers['x-user-id'] || null,
        metadata: { email: user.email, roleId: roleId || null },
      }).catch(() => {});
    }

    logger.info('Admin created user', { userId: user.id, tenantId: user.tenantId, email: user.email, roleId });

    res.status(201).json({
      message: 'User created. A welcome email with their temporary password has been sent.',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        mustChangePassword: user.mustChangePassword,
        role: assignedRole,
        tenant: { id: user.tenant.id, name: user.tenant.name, code: user.tenant.code },
      },
    });
  } catch (error) {
    next(error);
  }
}
