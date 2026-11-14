import { z } from 'zod';
import { AppError, ValidationError, ForbiddenError } from '../../../../../shared/common/errors.js';
import { randomBytes } from 'crypto';
import { createIamUser } from '../../services/iamIdentity.service.js';
import { requireApiKeyActor } from './apiKeyActor.js';

/**
 * inviteUser mutation
 *
 * Provisions a new user account inside the partner's own tenant.
 * - tenantId is always pulled from context — partners cannot create users
 *   in other tenants.
 * - roleId, if provided, must belong to the caller's tenant and must NOT be
 *   a system role.
 * - IAM creates and hashes the temporary credential and publishes onboarding.
 * - IACMS stores the local identity projection, department, and optional role.
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
export const externalSideEffect = true;

export async function execute(data, context) {
  const { tenantId, prisma } = context;
  const actorId = requireApiKeyActor(context);

  // Validate all IACMS-owned values under the partner database role's tenant RLS.
  const { departmentId, role } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, true)`;
    const existing = await tx.identityProjection.findFirst({
      where: { tenantId, email: data.email }, select: { subjectId: true },
    });
    if (existing) throw new ValidationError(`A user with email "${data.email}" already exists in this organization.`);

    let localDepartmentId = null;
    if (data.departmentCode) {
      const dept = await tx.department.findFirst({
        where: { tenantId, code: data.departmentCode, isActive: true }, select: { id: true },
      });
      if (!dept) throw new ValidationError(`Department with code "${data.departmentCode}" not found or inactive in this organization.`);
      localDepartmentId = dept.id;
    }

    let localRole = null;
    if (data.roleId) {
      localRole = await tx.role.findUnique({
        where: { id: data.roleId },
        select: { id: true, name: true, tenantId: true, isSystemRole: true, isActive: true },
      });
      if (!localRole || localRole.tenantId !== tenantId || !localRole.isActive) {
        throw new ValidationError('Role not found in this organization.');
      }
      if (localRole.isSystemRole) throw new ForbiddenError('System roles cannot be assigned via the Partner API.');
    }
    return { departmentId: localDepartmentId, role: localRole };
  });

  const emailLocal = data.email.split('@')[0].replace(/[^a-z0-9_.-]/gi, '').slice(0, 45) || 'user';
  const username = `${emailLocal}_${randomBytes(3).toString('hex')}`;
  const created = await createIamUser({
    actorId,
    tenantId,
    fields: { email: data.email, firstName: data.firstName, lastName: data.lastName, username },
  });
  if (!created?.id) throw new ValidationError('IAM did not return the created identity subject.');

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, true)`;
      await tx.identityProjection.upsert({
        where: { subjectId_tenantId: { subjectId: String(created.id), tenantId } },
        create: {
          subjectId: String(created.id), tenantId, departmentId,
          email: created.email, username: created.username || username,
          firstName: created.firstName || data.firstName, lastName: created.lastName || data.lastName,
          phone: data.phone ?? null, isActive: true, sourceVersion: 0n, sourceUpdatedAt: new Date(),
        },
        update: {
          departmentId, email: created.email, username: created.username || username,
          firstName: created.firstName || data.firstName, lastName: created.lastName || data.lastName,
          phone: data.phone ?? null, isActive: true, deletedAt: null, projectedAt: new Date(),
        },
      });
      if (role) {
        await tx.userRole.create({
          data: { userId: String(created.id), roleId: role.id, assignedBy: actorId },
        });
      }
    });
  } catch (error) {
    throw new AppError(`IAM created subject ${created.id}, but IACMS could not finish local provisioning. Reconcile that subject before retrying.`, 503, 'IAM_PROVISIONING_PARTIAL');
  }

  return {
    userId: created.id,
    email: created.email,
    firstName: created.firstName,
    lastName: created.lastName,
    username: created.username || username,
    tenantId,
    departmentId,
    mustChangePassword: created.mustChangePassword ?? true,
    createdAt: new Date().toISOString(),
    note: 'User has been created. They must set a password on first login.',
  };
}
