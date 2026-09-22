import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../../../../shared/common/errors.js';

/**
 * updateUser mutation
 *
 * Syncs mutable profile fields for an existing user within the partner's tenant.
 *
 * Strictly immutable fields (never writable via this mutation):
 *   email, username, tenantId, passwordHash, isEmailVerified,
 *   mustChangePassword, roles, isActive.
 *
 * Use deactivateUser to toggle isActive.
 * Role assignments must be managed by a human session via the internal UI.
 *
 * Scope required: users:update
 */

export const schema = z.object({
  userId: z.string().uuid(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional().nullable(),
  departmentCode: z.string().max(50).optional().nullable(),
}).refine(
  (obj) => Object.keys(obj).length > 1,
  { message: 'Provide at least one field to update besides userId.' },
);

export const requiredScope = 'users:update';

export async function execute(data, context) {
  const { tenantId, prisma } = context;
  const { userId, ...fields } = data;

  // 1. Load user — must belong to caller's tenant
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!user) throw new NotFoundError('User');

  const updatePayload = {};

  // 2. Resolve departmentId if departmentCode was provided
  if ('departmentCode' in fields) {
    if (fields.departmentCode === null) {
      updatePayload.departmentId = null;
    } else {
      const dept = await prisma.department.findFirst({
        where: { tenantId, code: fields.departmentCode, isActive: true },
        select: { id: true },
      });
      if (!dept) {
        throw new ValidationError(
          `Department with code "${fields.departmentCode}" not found or inactive in this organization.`,
        );
      }
      updatePayload.departmentId = dept.id;
    }
  }

  // 3. Build the rest of the payload
  if (fields.firstName !== undefined) updatePayload.firstName = fields.firstName;
  if (fields.lastName  !== undefined) updatePayload.lastName  = fields.lastName;
  if ('phone' in fields)              updatePayload.phone     = fields.phone ?? null;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updatePayload,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      updatedAt: true,
    },
  });

  return {
    userId: updated.id,
    email: updated.email,
    firstName: updated.firstName,
    lastName: updated.lastName,
    updatedFields: Object.keys(updatePayload).map((k) =>
      k === 'departmentId' ? 'departmentCode' : k,
    ),
    updatedAt: updated.updatedAt.toISOString(),
  };
}
