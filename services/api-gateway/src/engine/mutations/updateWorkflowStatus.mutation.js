import { z } from 'zod';
import { BusinessRuleViolationError, NotFoundError } from '../../../../../shared/common/errors.js';

export const schema = z.object({
  workflowId: z.string().uuid(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});

export const requiredScope = 'workflows:update';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;

  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { createdBy: true } });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Check if workflow exists and belongs to tenant
    const workflow = await tx.workflow.findUnique({ 
      where: { id: data.workflowId },
      include: { steps: true, transitions: true } 
    });
    
    if (!workflow || workflow.tenantId !== tenantId) throw new NotFoundError('Workflow');

    // 2. Validate Publishing rules
    if (data.status === 'PUBLISHED') {
      if (workflow.steps.length === 0) {
        throw new BusinessRuleViolationError('Cannot publish a workflow with no steps.');
      }
      const initialSteps = workflow.steps.filter(s => s.isInitial);
      if (initialSteps.length === 0) {
        throw new BusinessRuleViolationError('Cannot publish a workflow without an initial step.');
      }
    }

    // 3. Update the workflow status
    const updateData = { status: data.status };
    if (data.status === 'PUBLISHED' && !workflow.publishedAt) {
      updateData.publishedAt = new Date();
    }

    const updatedWorkflow = await tx.workflow.update({
      where: { id: data.workflowId },
      data: updateData,
    });

    return {
      workflowId: updatedWorkflow.id,
      status: updatedWorkflow.status,
    };
  });
}
