import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import prisma from '../../config/database.js';
import { getRedisClient } from '../../config/redis.config.js';
import { ValidationError, UnauthorizedError, NotFoundError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import {
  JWT_SECRET,
  LOCKOUT_ATTEMPTS,
  LOCKOUT_SECONDS,
  getEventBus,
  generateTokens,
} from '../../utils/auth.helpers.js';
import { withAuditClient } from '../../utils/audit.helpers.js';

const logger = new Logger('auth-service');

/**
 * POST /auth/login
 * Validates credentials, enforces account lockout, issues JWT tokens.
 */
export async function login(req, res, next) {
  try {
    const { validateLoginRequest } = await import('../../utils/validators.js');
    const { email, password, tenantCode } = validateLoginRequest(req.body);

    if (!password) throw new ValidationError('Password is required');

    const redis = getRedisClient();
    const lockKey = `auth:lockout:${email}`;
    const attemptsKey = `auth:attempts:${email}`;

    // Check lockout before DB hit
    if (redis) {
      try {
        const locked = await redis.get(lockKey);
        if (locked) {
          const ttl = await redis.ttl(lockKey);
          throw new UnauthorizedError(
            `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(ttl / 60)} minute(s).`
          );
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
      }
    }

    // Resolve tenant
    let tenant = null;
    if (tenantCode) {
      tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
      if (!tenant) throw new NotFoundError('Tenant');
      if (!tenant.isActive) throw new UnauthorizedError('Tenant is inactive');
    }

    // Find user (include role IDs for JWT + downstream workflow RBAC)
    const user = await prisma.user.findFirst({
      where: { email, ...(tenant && { tenantId: tenant.id }) },
      include: { tenant: true, userRoles: { select: { roleId: true } } },
    });

    if (!user) throw new UnauthorizedError('Invalid credentials');

    // Verify password — track failures for lockout
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      if (redis) {
        try {
          const attempts = await redis.incr(attemptsKey);
          await redis.expire(attemptsKey, LOCKOUT_SECONDS);
          if (attempts >= LOCKOUT_ATTEMPTS) {
            await redis.set(lockKey, '1', 'EX', LOCKOUT_SECONDS);
            await redis.del(attemptsKey);
            logger.warn('Account locked after failed attempts', { email });
          }
        } catch {
          // Redis unavailable — skip counter
        }
      }
      const failBus = getEventBus();
      if (failBus) {
        failBus
          .publish(
            TOPICS.AUDIT_LOG,
            withAuditClient(
              {
                tenantId: user.tenantId,
                entityType: 'user',
                entityId: user.id,
                action: 'login_failure',
                userId: null,
                oldValues: null,
                newValues: { outcome: 'failure' },
                metadata: { reason: 'invalid_credentials' },
              },
              req,
            ),
          )
          .catch(() => {});
      }
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!user.isActive) throw new UnauthorizedError('Account is inactive');
    if (!user.tenant.isActive) throw new UnauthorizedError('Tenant is inactive');

    // Clear failed attempt counters on success
    if (redis) {
      try { await redis.del(lockKey, attemptsKey); } catch { /* no-op */ }
    }

    const roleIds = user.userRoles.map((ur) => ur.roleId);
    const { accessToken, refreshToken } = generateTokens(user, roleIds);

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_LOGGED_IN, { userId: user.id, tenantId: user.tenantId })
        .catch(err => logger.warn('Failed to publish user.logged_in event', { error: err.message }));

      bus
        .publish(
          TOPICS.AUDIT_LOG,
          withAuditClient(
            {
              tenantId: user.tenantId,
              entityType: 'user',
              entityId: user.id,
              action: 'login_success',
              userId: user.id,
              oldValues: null,
              newValues: { outcome: 'success' },
              metadata: {},
            },
            req,
          ),
        )
        .catch(() => {});
    }

    logger.info('User logged in', { userId: user.id, tenantId: user.tenantId });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        departmentId: user.departmentId ?? null,
        mustChangePassword: user.mustChangePassword,
        roles: roleIds,
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          code: user.tenant.code,
          config: user.tenant.config ?? {},
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
 * POST /auth/refresh
 * Verifies a refresh token and issues a new token pair.
 */
export async function refreshToken(req, res, next) {
  try {
    const { refreshToken: token } = req.body;

    if (!token) throw new ValidationError('Refresh token is required');

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { tenant: true, userRoles: { select: { roleId: true } } },
    });

    if (!user || !user.isActive) throw new UnauthorizedError('Invalid token');

    const roleIds = user.userRoles.map((ur) => ur.roleId);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user, roleIds);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/logout
 * Blacklists the current JWT in Redis until it naturally expires.
 */
export async function logout(req, res, next) {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.jti && decoded?.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          const redis = getRedisClient();
          if (redis) {
            await redis.set(`auth:blacklist:${decoded.jti}`, '1', 'EX', ttl);
          }
        }
      }
    }
    const logoutBus = getEventBus();
    if (logoutBus && req.user) {
      logoutBus
        .publish(
          TOPICS.AUDIT_LOG,
          withAuditClient(
            {
              tenantId: req.user.tenantId,
              entityType: 'user',
              entityId: req.user.id,
              action: 'logout',
              userId: req.user.id,
              oldValues: null,
              newValues: { sessionEnded: true },
              metadata: { source: 'session' },
            },
            req,
          ),
        )
        .catch(() => {});
    }

    logger.info('User logged out', { userId: req.user?.id });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
}
