/**
 * Central case visibility: tenant admins see all cases in tenant; others see assigned or created.
 * Platform system_admin is NOT granted tenant-wide case access (see RBAC + seed).
 */

import { ValidationError, NotFoundError } from '../../../../shared/common/errors.js';
import {
  readableCaseConditions,
  incomingReferralReadableCondition,
} from '../utils/tenant-scope.js';

/** Tenant-wide case visibility applies only to `tenant_admin`; `system_admin` is not expanded here by design. */
export async function userHasTenantWideCaseAccess(prisma, userId) {
  const rows = await prisma.userRole.findMany({
    where: {
      userId,
      role: { name: 'tenant_admin', isActive: true },
    },
    select: { roleId: true },
    take: 1,
  });
  return rows.length > 0;
}

export async function findCaseForUser(prisma, { tenantId, userId, caseId, include, select }) {
  if (!tenantId || !userId) {
    throw new ValidationError('Tenant ID and User ID are required in headers');
  }
  const isAdmin = await userHasTenantWideCaseAccess(prisma, userId);
  const visibility = readableCaseConditions(tenantId);

  const where = isAdmin
    ? { id: caseId, ...visibility }
    : {
        id: caseId,
        ...visibility,
        AND: [
          {
            OR: [
              { assignedTo: userId },
              { createdBy: userId },
              { tenantId },
              { currentTenantId: tenantId },
              { originatingTenantId: tenantId },
              incomingReferralReadableCondition(tenantId),
            ],
          },
        ],
      };

  const opts = { where };
  if (include) opts.include = include;
  if (select) opts.select = select;
  return prisma.case.findFirst(opts);
}

export async function assertCaseReadable(prisma, req, caseId, include) {
  const tenantId = req.headers['x-tenant-id'];
  const userId = req.headers['x-user-id'];
  const row = await findCaseForUser(prisma, { tenantId, userId, caseId, include });
  if (!row) throw new NotFoundError('Case');
  return row;
}

export async function assertCaseMutable(prisma, req, caseId, include) {
  return assertCaseReadable(prisma, req, caseId, include);
}

/** Steps where non-admins may edit case metadata (aligned with intake / draft). */
export const REGISTRAR_EDITABLE_STEP_KEYS = new Set(['intake', 'draft']);

/**
 * Non–tenant-admins may only patch profile fields on early steps.
 */
export async function assertRegistrarMetadataEditAllowed(prisma, req, caseRow) {
  const userId = req.headers['x-user-id'];
  const isAdmin = await userHasTenantWideCaseAccess(prisma, userId);
  if (isAdmin) return;

  if (!caseRow.currentStepId) {
    throw new ValidationError('Case has no current step; metadata edit is not allowed');
  }
  const step = await prisma.workflowStep.findFirst({
    where: { id: caseRow.currentStepId },
    select: { key: true },
  });
  const key = step?.key || '';
  if (!REGISTRAR_EDITABLE_STEP_KEYS.has(key)) {
    throw new ValidationError(
      'Case metadata can only be edited during intake/draft steps unless you are a tenant administrator'
    );
  }
}
