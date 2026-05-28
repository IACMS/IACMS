import prisma from '../config/database.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';
import {
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  WorkflowNotPublishedError,
} from '../../../../shared/common/errors.js';
import { fetchWorkflowFull } from './workflow.client.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'case-service');

function workflowHeaders(req) {
  const h = {};
  if (req?.headers?.['x-user-id']) h['x-user-id'] = String(req.headers['x-user-id']);
  return h;
}

function parseRoleIds(req) {
  const raw = req.headers['x-user-roles'];
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Validates and executes a workflow transition against the authoritative workflow projection.
 */
export async function executeTransition(req, caseId, transitionId) {
  const tenantId = String(req.headers['x-tenant-id'] || '');
  if (!tenantId) throw new ValidationError('x-tenant-id required');
  const actorId = String(req.headers['x-user-id'] || '');
  if (!actorId) throw new ValidationError('x-user-id required');
  const roleIds = parseRoleIds(req);
  const comment = req.body?.comment;
  const hdr = workflowHeaders(req);

  const caseRow = await prisma.case.findFirst({
    where: { id: caseId, currentTenantId: tenantId, deletedAt: null },
  });
  if (!caseRow) throw new NotFoundError('Case');

  let full;
  try {
    full = await fetchWorkflowFull(caseRow.workflowId, tenantId, hdr);
  } catch {
    throw new WorkflowNotPublishedError('Unable to resolve workflow definition');
  }

  const transition = full.transitions.find(t => t.id === transitionId);
  if (!transition) throw new NotFoundError('Transition');
  if (transition.fromStepId !== caseRow.currentStepId) {
    throw new InvalidTransitionError('Transition does not apply to the current step');
  }

  if (transition.requiresComment && (!comment || !String(comment).trim())) {
    throw new ValidationError('Comment required for this transition');
  }

  if (transition.requiresAttachment) {
    const ac = await prisma.caseAttachment.count({
      where: { caseId, deletedAt: null },
    });
    if (ac === 0) throw new ValidationError('Attachment required before this transition');
  }

  if (transition.allowedRoleIds?.length) {
    const ok = roleIds.some(r => transition.allowedRoleIds.includes(r));
    if (!ok) throw new ForbiddenError('Actor role not permitted for this transition');
  }

  const toStep = full.steps.find(s => s.id === transition.toStepId);

  const updated = await prisma.$transaction(async tx => {
    const row = await tx.case.findFirst({
      where: { id: caseId, currentTenantId: tenantId, currentStepId: caseRow.currentStepId, deletedAt: null },
    });
    if (!row) throw new NotFoundError('Case');

    await tx.case.update({
      where: { id: caseId },
      data: {
        currentStepId: transition.toStepId,
        closedAt: toStep?.isFinal ? new Date() : null,
        status: toStep?.isFinal ? 'closed' : row.status,
      },
    });

    await tx.caseHistory.create({
      data: {
        caseId,
        tenantId,
        transitionId,
        fromStepId: row.currentStepId,
        toStepId: transition.toStepId,
        actorId,
        comment: comment || null,
      },
    });

    return tx.case.findUnique({
      where: { id: caseId },
      include: { currentStep: true },
    });
  });

  await eventBus.publish(TOPICS.CASE_TRANSITIONED, {
    caseId,
    tenantId,
    workflowId: caseRow.workflowId,
    workflowVersion: caseRow.workflowVersion,
    transitionId,
    fromStepId: transition.fromStepId,
    toStepId: transition.toStepId,
    actorId,
    comment: comment ?? null,
    caseNumber: updated.caseNumber,
    occurredAt: new Date().toISOString(),
  });

  let relatedTenantId = null;
  if (caseRow.originatingTenantId && caseRow.originatingTenantId !== tenantId) {
    relatedTenantId = caseRow.originatingTenantId;
  } else if (caseRow.currentTenantId && caseRow.currentTenantId !== tenantId) {
    relatedTenantId = caseRow.currentTenantId;
  }

  await eventBus.publish(TOPICS.AUDIT_LOG, {
    tenantId,
    relatedTenantId,
    entityType: 'case',
    entityId: caseId,
    action: 'case.transition',
    userId: actorId,
    oldValues: {
      currentStepId: caseRow.currentStepId,
      stepKey: full.steps.find(s => s.id === transition.fromStepId)?.key ?? null,
    },
    newValues: {
      currentStepId: transition.toStepId,
      stepKey: toStep?.key ?? null,
      transitionId,
      transitionName: transition.name,
    },
  });

  return updated;
}

export async function httpExecuteTransition(req, res, next) {
  try {
    const updated = await executeTransition(req, req.params.id, req.params.transitionId);
    res.json({ case: updated });
  } catch (e) {
    next(e);
  }
}

export { parseRoleIds };
