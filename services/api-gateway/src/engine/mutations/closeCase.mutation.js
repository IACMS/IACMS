import { z } from 'zod';
import { NotFoundError, BusinessRuleViolationError } from '../../../../../shared/common/errors.js';

/**
 * closeCase mutation
 *
 * Programmatically closes an open case owned by the partner's tenant.
 * Sets status → "closed", closedAt → now(), and writes a CaseHistory
 * entry so the action is fully auditable.
 *
 * Scope required: cases:update
 */

export const schema = z.object({
  caseId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

export const requiredScope = 'cases:update';

export async function execute(data, context) {
  const { tenantId, apiKeyId, prisma } = context;

  // Resolve the actor user for the history entry
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { createdBy: true },
  });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Load case — must belong to caller's tenant and not be soft-deleted
    const kase = await tx.case.findFirst({
      where: { id: data.caseId, tenantId, deletedAt: null },
      include: { currentStep: { select: { id: true, name: true } } },
    });
    if (!kase) throw new NotFoundError('Case');

    // 2. Idempotency guard — block if already closed / resolved
    if (kase.status === 'closed' || kase.status === 'resolved') {
      throw new BusinessRuleViolationError(
        `Case "${kase.caseNumber}" is already ${kase.status} and cannot be closed again.`,
      );
    }

    const now = new Date();

    // 3. Close the case
    await tx.case.update({
      where: { id: kase.id },
      data: {
        status: 'closed',
        closedAt: now,
        resolvedAt: now,
      },
    });

    // 4. Write a history entry so the closure is fully traceable
    await tx.caseHistory.create({
      data: {
        caseId: kase.id,
        tenantId,
        fromStepId: kase.currentStepId ?? undefined,
        toStepId: kase.currentStepId ?? kase.id, // stay on current step; required FK
        actorId: actorUserId,
        comment: data.reason
          ? `Case closed via Partner API. Reason: ${data.reason}`
          : 'Case closed via Partner API.',
      },
    });

    return {
      caseId: kase.id,
      caseNumber: kase.caseNumber,
      status: 'closed',
      closedAt: now.toISOString(),
    };
  });
}
