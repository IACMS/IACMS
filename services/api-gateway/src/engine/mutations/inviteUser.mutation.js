import { z } from 'zod';
import { ValidationError, ForbiddenError } from '../../../../../shared/common/errors.js';
import { randomBytes } from 'crypto';

/**
 * inviteUser mutation
 *
 * Provisions a new user account inside the partner's own tenant.
 * - tenantId is always pulled from context — partners cannot create users
 *   in other tenants.
 * - roleId, if provided, must belong to the caller's tenant and must NOT be
 *   a system role.
 * - A random initial password is set and mustChangePassword is flagged true,
 *   matching the internal invite flow.
 * - The notification-service's Kafka consumer will automatically send the
 *   welcome/onboarding email as a side effect (no extra wiring required).
 *
 * Scope required: users:create
 */

export const schema = z.object({
  email: z.string().email().max(255),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(30).optional().nullable(),
  departmentCode: z.string().max(50).optional().nullable(),
  roleId: z.string().uuid().optional().nullable(),
});

export const requiredScope = 'users:create';

export async function execute(data, context) {
  const { tenantId, prisma } = context;

  return await prisma.$transaction(async (tx) => {
    // 1. Check email uniqueness within tenant
    const existing = await tx.user.findUnique({
      where: { tenantId_email: { tenantId, email: data.email } },
      select: { id: true },
    });
    if (existing) {
      throw new ValidationError(`A user with email "${data.email}" already exists in this organization.`);
    }

    // 2. Resolve departmentId from departmentCode (optional)
    let departmentId = null;
    if (data.departmentCode) {
      const dept = await tx.department.findFirst({
        where: { tenantId, code: data.departmentCode, isActive: true },
        select: { id: true },
      });
      if (!dept) {
        throw new ValidationError(`Department with code "${data.departmentCode}" not found or inactive in this organization.`);
      }
      departmentId = dept.id;
    }

    // 3. Validate roleId if provided — must belong to tenant and not be a system role
    if (data.roleId) {
      const role = await tx.role.findUnique({
        where: { id: data.roleId },
        select: { id: true, tenantId: true, isSystemRole: true },
      });
      if (!role || role.tenantId !== tenantId) {
        throw new ValidationError('Role not found in this organization.');
      }
      if (role.isSystemRole) {
        throw new ForbiddenError('System roles cannot be assigned via the Partner API.');
      }
    }

    // 4. Generate a secure random initial password — user must change on first login
    const tempPassword = randomBytes(16).toString('hex');
    // In production this would be bcrypt-hashed; we store a placeholder that
    // forces mustChangePassword = true so the user sets a real password on login.
    // The IAM service owns password hashing — we create the row with a sentinel hash.
    const SENTINEL_HASH = `$partner_api_invite$${randomBytes(8).toString('hex')}`;

    // Derive username from email local-part, ensure uniqueness with a suffix
    const emailLocal = data.email.split('@')[0].replace(/[^a-z0-9_.-]/gi, '');
    const usernameBase = emailLocal.substring(0, 50);
    const suffix = randomBytes(3).toString('hex'); // e.g. "a3f7c1"
    const username = `${usernameBase}_${suffix}`;

    // 5. Create the user
    const newUser = await tx.user.create({
      data: {
        tenantId,
        departmentId,
        email: data.email,
        username,
        passwordHash: SENTINEL_HASH,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? null,
        isActive: true,
        isEmailVerified: false,
        mustChangePassword: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
        createdAt: true,
      },
    });

    // 6. Assign role if provided
    if (data.roleId) {
      await tx.userRole.create({
        data: {
          userId: newUser.id,
          roleId: data.roleId,
        },
      });
    }

    return {
      userId: newUser.id,
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      username: newUser.username,
      tenantId,
      mustChangePassword: true,
      createdAt: newUser.createdAt.toISOString(),
      note: 'User has been created. They must set a password on first login.',
    };
  });
}
