import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { ValidationError, UnauthorizedError, NotFoundError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';
import EventBus from '../../../../shared/utils/eventBus.js';
import { validateLoginRequest, validateRegisterRequest } from '../utils/validators.js';

const logger = new Logger('auth-service');
let eventBus = null;

// Initialize event bus lazily (allows service to start without Redis)
function getEventBus() {
  if (!eventBus) {
    try {
      eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');
    } catch (error) {
      logger.warn('Failed to connect to Redis event bus', { error: error.message });
    }
  }
  return eventBus;
}

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

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
    // Validate input
    const { email, password, firstName, lastName, tenantId, username } = validateRegisterRequest(req.body);

    // Check if tenant exists and is active
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    if (!tenant.isActive) {
      throw new ValidationError('Cannot register with inactive tenant');
    }

    // Check if user exists (by email)
    const existingUser = await prisma.user.findFirst({
      where: {
        tenantId,
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
        tenantId,
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

