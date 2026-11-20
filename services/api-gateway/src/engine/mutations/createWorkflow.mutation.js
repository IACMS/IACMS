import { z } from 'zod';
import { BusinessRuleViolationError } from '../../../../../shared/common/errors.js';

const stepSchema = z.object({
  key: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  isInitial: z.boolean().default(false),
  isFinal: z.boolean().default(false),
  position: z.number().int().default(0),
  allowedRoleIds: z.array(z.string().uuid()).default([]),
  requiresAttachment: z.boolean().default(false),
});

const transitionSchema = z.object({
  fromStepKey: z.string().min(1).max(50),
  toStepKey: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  allowedRoleIds: z.array(z.string().uuid()).default([]),
  requiresComment: z.boolean().default(false),
  requiresAttachment: z.boolean().default(false),
  timeLimitType: z.string().default('NONE'),
  timeLimitAmount: z.number().int().optional(),
  timeLimitUnit: z.string().optional(),
});

export const schema = z.object({
  key: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  departmentId: z.string().uuid().optional(),
  definition: z.record(z.unknown()).optional(),
  steps: z.array(stepSchema).min(1, 'At least one step is required'),
  transitions: z.array(transitionSchema).default([]),
});

export const requiredScope = 'workflows:create';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;

  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { createdBy: true } });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Check if a workflow with this key exists to determine version
    const existingWorkflows = await tx.workflow.findMany({
      where: { tenantId, key: data.key },
      orderBy: { version: 'desc' },
      take: 1,
    });
    
    const newVersion = existingWorkflows.length > 0 ? existingWorkflows[0].version + 1 : 1;

    // 2. Validate department if provided
    if (data.departmentId) {
      const dept = await tx.department.findUnique({ where: { id: data.departmentId } });
      if (!dept || dept.tenantId !== tenantId) throw new BusinessRuleViolationError('Invalid departmentId');
    }

    // 3. Create Workflow (DRAFT status)
    const workflow = await tx.workflow.create({
      data: {
        tenantId,
        key: data.key,
        name: data.name,
        description: data.description,
        departmentId: data.departmentId,
        definition: data.definition || {},
        version: newVersion,
        status: 'DRAFT',
        isActive: true,
        createdBy: actorUserId,
      },
    });

    // 4. Create WorkflowSteps
    const stepKeyToIdMap = {};
    for (const stepData of data.steps) {
      const step = await tx.workflowStep.create({
        data: {
          workflowId: workflow.id,
          key: stepData.key,
          name: stepData.name,
          description: stepData.description,
          isInitial: stepData.isInitial,
          isFinal: stepData.isFinal,
          position: stepData.position,
          allowedRoleIds: stepData.allowedRoleIds,
          requiresAttachment: stepData.requiresAttachment,
        }
      });
      stepKeyToIdMap[step.key] = step.id;
    }

    // 5. Create WorkflowTransitions
    for (const transData of data.transitions) {
      const fromStepId = stepKeyToIdMap[transData.fromStepKey];
      const toStepId = stepKeyToIdMap[transData.toStepKey];
      
      if (!fromStepId) throw new BusinessRuleViolationError(`Transition references unknown fromStepKey: ${transData.fromStepKey}`);
      if (!toStepId) throw new BusinessRuleViolationError(`Transition references unknown toStepKey: ${transData.toStepKey}`);

      await tx.workflowTransition.create({
        data: {
          workflowId: workflow.id,
          fromStepId,
          toStepId,
          name: transData.name,
          description: transData.description,
          allowedRoleIds: transData.allowedRoleIds,
          requiresComment: transData.requiresComment,
          requiresAttachment: transData.requiresAttachment,
          timeLimitType: transData.timeLimitType,
          timeLimitAmount: transData.timeLimitAmount,
          timeLimitUnit: transData.timeLimitUnit,
        }
      });
    }

    return {
      workflowId: workflow.id,
      key: workflow.key,
      version: workflow.version,
      status: workflow.status,
    };
  });
}
