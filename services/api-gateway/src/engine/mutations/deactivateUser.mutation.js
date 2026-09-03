import { z } from 'zod';
import { NotFoundError, ForbiddenError } from '../../../../../shared/common/errors.js';

/**
 * deactivateUser mutation
 *
 * Sets isActive: false on a user within the partner's tenant.
 * This prevents the user from logging in without permanently deleting
 * their record or any data associated with them.
 *
 * Guards:
 * - User must belong to context.tenantId.
 * - Partners cannot deactivate the user that owns the API key (self-lock).
 *
 * Scope required: users:update
 */

export const schema = z.object({
  userId: z.string().uuid(),
});

export const requiredScope = 'users:update';

export async function execute(data, context) {
  const { tenantId, apiKeyId, prisma } = context;

  // Resolve the actor (key owner) to prevent self-deactivation
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { createdBy: true },
  });

  // 1. Self-deactivation guard
  if (data.userId === apiKey.createdBy) {
    throw new ForbiddenError(
      'You cannot deactivate the user that owns this API key. Revoke the key first.',
    );
  }

  // 2. Load user — must belong to caller's tenant
  const user = await prisma.user.findFirst({
    where: { id: data.userId, tenantId },
    select: { id: true, email: true, isActive: true, firstName: true, lastName: true },
  });
  if (!user) throw new NotFoundError('User');

  // 3. Idempotency — already inactive
  if (!user.isActive) {
    return {
      userId: user.id,
      email: user.email,
      isActive: false,
      message: `User "${user.firstName} ${user.lastName}" is already inactive.`,
    };
  }

  // 4. Deactivate
  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: false },
  });

  return {
    userId: user.id,
    email: user.email,
    isActive: false,
    message: `User "${user.firstName} ${user.lastName}" has been deactivated.`,
  };
}
