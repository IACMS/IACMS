import { z } from 'zod';
import { BusinessRuleViolationError } from '../../../../../shared/common/errors.js';

export const schema = z.object({
  workflowKey: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  type: z.string().min(1).max(100),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  data: z.record(z.unknown()).optional(),
});

export const requiredScope = 'cases:create';

export async function execute(data, context) {
  const { tenantId, prisma, apiKeyId } = context;
  
  const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { createdBy: true } });
  const actorUserId = apiKey.createdBy;

  return await prisma.$transaction(async (tx) => {
    // 1. Find published workflow by key
    const workflow = await tx.workflow.findFirst({
      where: { tenantId, key: data.workflowKey, status: 'PUBLISHED' },
      include: { steps: { orderBy: [{ position: 'asc' }] } },
      orderBy: { version: 'desc' },
    });
    if (!workflow) throw new BusinessRuleViolationError(`No published workflow found with key "${data.workflowKey}"`);

    // 2. Find initial step
    const initialStep = workflow.steps.find(s => s.isInitial);
    if (!initialStep) throw new BusinessRuleViolationError('Workflow has no initial step defined');

    // 3. Generate case number via CaseSequence
    const year = new Date().getFullYear();
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { code: true } });
    const seq = await tx.caseSequence.upsert({
      where: { tenantId_year: { tenantId, year } },
      create: { tenantId, year, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    });
    const caseNumber = `${tenant.code}-${year}-${String(seq.lastSeq).padStart(4, '0')}`;

    // 4. Create the case (use a system user ID for API key created cases)
    const newCase = await tx.case.create({
      data: {
        tenantId,
        originatingTenantId: tenantId,
        currentTenantId: tenantId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        currentStepId: initialStep.id,
        caseNumber,
        title: data.title,
        description: data.description || null,
        type: data.type,
        priority: data.priority,
        status: 'open',
        data: data.data || null,
        createdBy: actorUserId,
        metadata: { source: 'partner_api', apiKeyId },
      },
    });

    // 5. Create initial history entry
    await tx.caseHistory.create({
      data: {
        caseId: newCase.id,
        tenantId,
        toStepId: initialStep.id,
        actorId: actorUserId,
        comment: 'Case created via Partner API',
      },
    });

    return {
      caseId: newCase.id,
      caseNumber: newCase.caseNumber,
      status: newCase.status,
      currentStep: initialStep.name,
      createdAt: newCase.createdAt.toISOString(),
    };
  });
}
