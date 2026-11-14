import { z } from 'zod';
import { BusinessRuleViolationError, NotFoundError } from '../../../../../shared/common/errors.js';
import { requireApiKeyActor } from './apiKeyActor.js';

export const schema = z.object({
  caseId: z.string().uuid(),
  assignedTo: z.string().uuid(),
  assignmentType: z.string().min(1).max(50).default('manual'),
  notes: z.string().max(2000).optional(),
});

export const requiredScope = 'assignments:create';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;
  const actorUserId = requireApiKeyActor(context);

  return await prisma.$transaction(async (tx) => {
    // 1. Verify Case exists and belongs to tenant
    const kase = await tx.case.findFirst({
      where: { id: data.caseId, tenantId, deletedAt: null },
    });
    if (!kase) throw new NotFoundError('Case');
    if (kase.status === 'closed' || kase.status === 'resolved') {
      throw new BusinessRuleViolationError('Cannot assign a closed or resolved case.');
    }

    // 2. Verify User exists and belongs to tenant
    const assignee = await tx.identityProjection.findUnique({
      where: { subjectId_tenantId: { subjectId: data.assignedTo, tenantId } },
      select: { subjectId: true, isActive: true, deletedAt: true },
    });
    if (!assignee || !assignee.isActive || assignee.deletedAt) throw new NotFoundError('User to assign');

    // 3. Mark previous active assignments for this case and user as inactive
    await tx.assignment.updateMany({
      where: {
        caseId: data.caseId,
        isActive: true,
      },
      data: {
        isActive: false,
        unassignedAt: new Date(),
      }
    });

    // 4. Create new assignment
    const assignment = await tx.assignment.create({
      data: {
        caseId: data.caseId,
        assignedTo: assignee.subjectId,
        assignedBy: actorUserId,
        assignmentType: data.assignmentType,
        notes: data.notes,
        isActive: true,
      },
    });

    return {
      assignmentId: assignment.id,
      caseId: assignment.caseId,
      assignedTo: assignment.assignedTo,
      assignmentType: assignment.assignmentType,
    };
  });
}
