import prisma from '../config/database.js';
import { NotFoundError, ValidationError, WorkflowClosedError } from '../../../../shared/common/errors.js';
import { TOPICS } from '../../../../shared/utils/eventBus.js';
import { workflowEventBus as eventBus } from '../config/eventBus.js';

function auditActor(req) {
  const u = req.headers['x-user-id'];
  return u ? String(u) : null;
}

function tenantId(req) {
  const t = req.headers['x-tenant-id'];
  if (!t) throw new ValidationError('x-tenant-id header required');
  return t;
}

async function assertDraft(workflowId, tenant) {
  const wf = await prisma.workflow.findFirst({ where: { id: workflowId, tenantId: tenant } });
  if (!wf) throw new NotFoundError('Workflow');
  if (wf.status !== 'DRAFT') throw new WorkflowClosedError('Transitions can only change while workflow is draft');
  return wf;
}

export async function createTransition(req, res, next) {
  try {
    const tenant = tenantId(req);
    await assertDraft(req.params.id, tenant);
    const {
      name, fromStepId, toStepId, description,
      allowedRoleIds, requiresComment, requiresAttachment,
    } = req.body;
    if (!name || !fromStepId || !toStepId) {
      throw new ValidationError('name, fromStepId, and toStepId are required');
    }
    const tr = await prisma.workflowTransition.create({
      data: {
        workflowId: req.params.id,
        name,
        fromStepId,
        toStepId,
        description,
        allowedRoleIds: Array.isArray(allowedRoleIds) ? allowedRoleIds : [],
        requiresComment: Boolean(requiresComment),
        requiresAttachment: Boolean(requiresAttachment),
      },
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId,
      entityType: 'workflow_transition',
      entityId: tr.id,
      action: 'workflow_transition.create',
      userId: auditActor(req),
      oldValues: null,
      newValues: {
        workflowId: req.params.id,
        name: tr.name,
        fromStepId: tr.fromStepId,
        toStepId: tr.toStepId,
      },
      metadata: {},
    });
    res.status(201).json({ transition: tr });
  } catch (e) {
    next(e);
  }
}

export async function deleteTransition(req, res, next) {
  try {
    const tenant = tenantId(req);
    await assertDraft(req.params.id, tenant);
    const tr = await prisma.workflowTransition.findFirst({
      where: { id: req.params.transitionId, workflowId: req.params.id },
    });
    if (!tr) throw new NotFoundError('Transition');
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId,
      entityType: 'workflow_transition',
      entityId: tr.id,
      action: 'workflow_transition.delete',
      userId: auditActor(req),
      oldValues: { name: tr.name, workflowId: req.params.id },
      newValues: { deleted: true },
      metadata: {},
    });
    await prisma.workflowTransition.delete({ where: { id: tr.id } });
    res.json({ message: 'Transition deleted' });
  } catch (e) {
    next(e);
  }
}
