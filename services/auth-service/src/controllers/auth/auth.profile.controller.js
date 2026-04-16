import prisma from '../../config/database.js';
import { NotFoundError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import { getEventBus } from '../../utils/auth.helpers.js';
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
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: true,
        lastLogin: true,
        createdAt: true,
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

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_UPDATED, {
        userId: user.id,
        tenantId: req.user.tenantId,
        updatedFields: Object.keys(fields),
        updatedBy: req.user.id,
      }).catch(err => logger.warn('Failed to publish user.updated event', { error: err.message }));
    }

    logger.info('User updated own profile', { userId: user.id });

    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    next(error);
  }
}
