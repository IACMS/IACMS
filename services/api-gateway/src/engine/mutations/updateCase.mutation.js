import { z } from 'zod';
import { NotFoundError, BusinessRuleViolationError } from '../../../../../shared/common/errors.js';

/**
 * updateCase mutation
 *
 * Allows a partner to update mutable fields on a case owned by their tenant.
 * Immutable fields (caseNumber, workflowId, status, currentStepId, createdBy,
 * tenantId) are never touched by this mutation — they are enforced by the
 * strict field allowlist in the Zod schema.
 *
 * Scope required: cases:update
 */

export const schema = z.object({
  caseId: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  type: z.string().min(1).max(100).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  data: z.record(z.unknown()).optional().nullable(),
}).refine(
  (obj) => Object.keys(obj).length > 1, // at least one field besides caseId
  { message: 'Provide at least one field to update besides caseId.' },
);

export const requiredScope = 'cases:update';

export async function execute(data, context) {
  const { tenantId, prisma } = context;
  const { caseId, ...fields } = data;

  // 1. Load the case — must belong to caller's tenant and not be soft-deleted
  const kase = await prisma.case.findFirst({
    where: { id: caseId, tenantId, deletedAt: null },
    select: { id: true, status: true, caseNumber: true },
  });
  if (!kase) throw new NotFoundError('Case');

  // 2. Block updates to closed / resolved cases
  if (kase.status === 'closed' || kase.status === 'resolved') {
    throw new BusinessRuleViolationError(
      `Cannot update a ${kase.status} case. Only open cases may be modified.`,
    );
  }

  // 3. Build update payload — only include fields explicitly provided
  const updatePayload = {};
  if (fields.title !== undefined)       updatePayload.title       = fields.title;
  if (fields.description !== undefined) updatePayload.description = fields.description;
  if (fields.priority !== undefined)    updatePayload.priority    = fields.priority;
  if (fields.type !== undefined)        updatePayload.type        = fields.type;
  if (fields.dueDate !== undefined)     updatePayload.dueDate     = fields.dueDate ? new Date(fields.dueDate) : null;
  if (fields.data !== undefined)        updatePayload.data        = fields.data;

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: updatePayload,
    select: {
      id: true,
      caseNumber: true,
      title: true,
      description: true,
      priority: true,
      type: true,
      status: true,
      dueDate: true,
      updatedAt: true,
    },
  });

  return {
    caseId: updated.id,
    caseNumber: updated.caseNumber,
    updatedFields: Object.keys(updatePayload),
    updatedAt: updated.updatedAt.toISOString(),
  };
}
