import prisma from '../config/database.js';
import { assignProjectRoleToIdentity, assertProjectRoleAssignmentAllowed } from './rbac.controller.js';
import { createIamUser } from '../services/iamIdentity.service.js';
import { clearPermissionCache } from '../middleware/rbac.middleware.js';
import { AppError, NotFoundError, ValidationError } from '../../../../shared/common/errors.js';

/** IAM creates credentials; IACMS stores department and project authorization. */
export async function createProjectUser(req, res, next) {
  try {
    const tenantId = req.user?.tenantId ? String(req.user.tenantId) : null;
    if (!req.user?.id) throw new AppError('Authentication is required', 401, 'UNAUTHORIZED');
    if (!tenantId) throw new ValidationError('An organization is required to create an IACMS user');

    const { email, firstName, lastName, username, roleId, departmentId } = req.body ?? {};
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) throw new ValidationError('A valid email is required');
    if (typeof firstName !== 'string' || !firstName.trim()) throw new ValidationError('First name is required');
    if (typeof lastName !== 'string' || !lastName.trim()) throw new ValidationError('Last name is required');

    let department = null;
    if (departmentId) {
      department = await prisma.department.findFirst({
        where: { id: String(departmentId), tenantId, isActive: true },
        select: { id: true },
      });
      if (!department) throw new ValidationError('Department must belong to this organization and be active');
    }

    let role = null;
    let assignment = null;
    if (roleId) {
      role = await prisma.role.findUnique({ where: { id: String(roleId) } });
      if (!role?.isActive) throw new NotFoundError('Active role');
      assignment = await assertProjectRoleAssignmentAllowed(req, role);
    }

    // IAM is authoritative for email/username uniqueness and password creation.
    const created = await createIamUser({
      actorId: req.user.id,
      tenantId,
      fields: { email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), ...(username ? { username: String(username).trim() } : {}) },
    });
    if (!created?.id) throw new AppError('IAM created an account without returning its subject ID', 503, 'IAM_PROVISIONING_INCOMPLETE');

    try {
      const now = new Date();
      let userRole = null;
      await prisma.$transaction(async (tx) => {
        await tx.identityProjection.upsert({
          where: { subjectId_tenantId: { subjectId: String(created.id), tenantId } },
          create: {
            subjectId: String(created.id), tenantId, departmentId: department?.id ?? null,
            email: created.email, username: created.username || created.email,
            firstName: created.firstName || firstName.trim(), lastName: created.lastName || lastName.trim(),
            phone: null, isActive: true, sourceVersion: 0n, sourceUpdatedAt: now, deletedAt: null,
          },
          update: {
            departmentId: department?.id ?? null,
            email: created.email, username: created.username || created.email,
            firstName: created.firstName || firstName.trim(), lastName: created.lastName || lastName.trim(),
            isActive: true, sourceUpdatedAt: now, deletedAt: null, projectedAt: now,
          },
        });
        if (role && assignment) {
          userRole = await assignProjectRoleToIdentity({
            ...assignment, subjectId: String(created.id), role, db: tx, clearCache: false,
          });
        }
      });
      if (userRole) await clearPermissionCache(String(created.id), tenantId);
      return res.status(201).json({
        message: created.message || 'User created. A welcome email with their temporary password has been sent.',
        user: { ...created, departmentId: department?.id ?? null, role: userRole?.role ?? null },
      });
    } catch (error) {
      // IAM creation is a committed remote side effect. Give the caller the stable
      // subject ID so an operator can reconcile the local projection/role safely.
      return res.status(503).json({
        error: {
          code: 'IAM_PROVISIONING_PARTIAL',
          message: 'IAM created the account, but IACMS could not finish local provisioning. Retry reconciliation using the returned subject ID.',
          subjectId: String(created.id),
        },
      });
    }
  } catch (error) {
    next(error);
  }
}
