import { z } from 'zod';
import { BusinessRuleViolationError, NotFoundError } from '../../../../../shared/common/errors.js';

export const schema = z.object({
  caseId: z.string().uuid(),
  transitionId: z.string().uuid(),
  comment: z.string().max(5000).optional(),
});

export const requiredScope = 'cases:update';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;

  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { createdBy: true } });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Find case scoped to tenant
    const kase = await tx.case.findFirst({
      where: { id: data.caseId, tenantId, deletedAt: null },
      include: { currentStep: true },
    });
    if (!kase) throw new NotFoundError('Case');
    if (kase.status === 'closed' || kase.status === 'resolved') {
      throw new BusinessRuleViolationError('Cannot transition a closed or resolved case');
    }

    // 2. Find the transition
    const transition = await tx.workflowTransition.findUnique({
      where: { id: data.transitionId },
      include: { toStep: true },
    });
    if (!transition) throw new NotFoundError('Transition');
    if (transition.fromStepId !== kase.currentStepId) {
      throw new BusinessRuleViolationError('Transition is not valid from the current step');
    }

    // 3. Check business rules
    if (transition.requiresComment && !data.comment) {
      throw new BusinessRuleViolationError('This transition requires a comment');
    }

    // 4. Update case
    const newStatus = transition.toStep.isFinal ? 'resolved' : kase.status;
    const updatedCase = await tx.case.update({
      where: { id: kase.id },
      data: {
        currentStepId: transition.toStepId,
        status: newStatus,
        ...(transition.toStep.isFinal ? { resolvedAt: new Date(), closedAt: new Date() } : {}),
      },
    });

    // 5. Create history
    await tx.caseHistory.create({
      data: {
        caseId: kase.id,
        tenantId,
        transitionId: transition.id,
        fromStepId: kase.currentStepId,
        toStepId: transition.toStepId,
        actorId: actorUserId,
        comment: data.comment || 'Transition executed via Partner API',
      },
    });

    return {
      caseId: kase.id,
      caseNumber: kase.caseNumber,
      previousStep: kase.currentStep?.name,
      currentStep: transition.toStep.name,
      status: newStatus,
      transitionedAt: new Date().toISOString(),
    };
  });
}
