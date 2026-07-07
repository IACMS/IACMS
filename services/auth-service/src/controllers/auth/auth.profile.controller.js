import prisma from '../../config/database.js';
import { NotFoundError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import { getEventBus } from '../../utils/auth.helpers.js';
import { withAuditClient } from '../../utils/audit.helpers.js';
import { validateProfileUpdateRequest } from '../../utils/validators.js';

const logger = new Logger('auth-service');

/**
 * GET /auth/profile
 * Returns the full profile for the currently authenticated user.
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
        departmentId: true,
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: true,
        lastLogin: true,
        createdAt: true,
        department: {
          select: { id: true, code: true, name: true },
        },
        tenant: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (!user) throw new NotFoundError('User');

    res.json({ user });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /auth/profile
 * Allows the authenticated user to update their own firstName, lastName, or phone.
 * Email cannot be changed here — changing it would break the verified state.
 */
export async function updateProfile(req, res, next) {
  try {
    const fields = validateProfileUpdateRequest(req.body);

    const before = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { firstName: true, lastName: true, phone: true },
    });
    if (!before) throw new NotFoundError('User');

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: fields,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        isEmailVerified: true,
        mustChangePassword: true,
        updatedAt: true,
      },
    });

    const keys = Object.keys(fields);
    const oldValues = {};
    const newValues = {};
    for (const k of keys) {
      oldValues[k] = before[k];
      newValues[k] = user[k];
    }

    const bus = getEventBus();
    if (bus) {
      bus
        .publish(TOPICS.USER_UPDATED, {
          userId: user.id,
          tenantId: req.user.tenantId,
          updatedFields: keys,
          updatedBy: req.user.id,
        })
        .catch(err => logger.warn('Failed to publish user.updated event', { error: err.message }));
      bus
        .publish(
          TOPICS.AUDIT_LOG,
          withAuditClient(
            {
              tenantId: req.user.tenantId,
              entityType: 'user',
              entityId: user.id,
              action: 'profile_updated',
              userId: req.user.id,
              oldValues,
              newValues,
              metadata: {},
            },
            req,
          ),
        )
        .catch(() => {});
    }

    logger.info('User updated own profile', { userId: user.id });

    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    next(error);
  }
}
