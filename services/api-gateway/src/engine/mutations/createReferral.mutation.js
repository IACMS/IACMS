import { z } from 'zod';
import { BusinessRuleViolationError, NotFoundError, ValidationError } from '../../../../../shared/common/errors.js';

export const schema = z.object({
  caseId: z.string().uuid(),
  toTenantCode: z.string().min(1).max(50),
  toDepartmentCode: z.string().max(50).optional(),
  referralReason: z.string().min(1).max(5000),
  notes: z.string().max(5000).optional(),
});

export const requiredScope = 'referrals:create';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;

  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { createdBy: true } });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Find case - must be held by caller's tenant
    const kase = await tx.case.findFirst({
      where: { id: data.caseId, deletedAt: null },
    });
    if (!kase) throw new NotFoundError('Case');
    const currentHolder = kase.currentTenantId || kase.tenantId;
    if (currentHolder !== tenantId) {
      throw new BusinessRuleViolationError('Case is not currently held by your organization');
    }

    // 2. Find target tenant
    const toTenant = await tx.tenant.findUnique({ where: { code: data.toTenantCode } });
    if (!toTenant || !toTenant.isActive) throw new ValidationError(`Target organization "${data.toTenantCode}" not found or inactive`);
    if (toTenant.id === tenantId) throw new ValidationError('Cannot refer a case to your own organization');

    // 3. Find target department (optional)
    let toDepartmentId = null;
    if (data.toDepartmentCode) {
      const dept = await tx.department.findFirst({ where: { tenantId: toTenant.id, code: data.toDepartmentCode, isActive: true } });
      if (!dept) throw new ValidationError(`Department "${data.toDepartmentCode}" not found in target organization`);
      toDepartmentId = dept.id;
    }

    // 4. Create referral
    const referral = await tx.caseReferral.create({
      data: {
        caseId: kase.id,
        fromTenantId: tenantId,
        toTenantId: toTenant.id,
        toDepartmentId,
        referralReason: data.referralReason,
        notes: data.notes || null,
        status: 'pending',
        referredBy: actorUserId,
      },
    });

    // 5. Update case referral status
    await tx.case.update({
      where: { id: kase.id },
      data: { referralStatus: 'pending_referral' },
    });

    return {
      referralId: referral.id,
      caseId: kase.id,
      caseNumber: kase.caseNumber,
      fromTenant: tenantId,
      toTenant: toTenant.code,
      status: 'pending',
      referredAt: referral.referredAt.toISOString(),
    };
  });
}
