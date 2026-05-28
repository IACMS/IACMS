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
  if (wf.status !== 'DRAFT') throw new WorkflowClosedError('Steps can only change while workflow is draft');
  return wf;
}

export async function createStep(req, res, next) {
  try {
    const tenant = tenantId(req);
    await assertDraft(req.params.id, tenant);
    const { key, name, description, isInitial, isFinal, position, allowedRoleIds } = req.body;
    if (!key || !name) throw new ValidationError('key and name are required');

    const step = await prisma.workflowStep.create({
      data: {
        workflowId: req.params.id,
        key,
        name,
        description,
        isInitial: Boolean(isInitial),
        isFinal: Boolean(isFinal),
        position: position ?? 0,
        allowedRoleIds: Array.isArray(allowedRoleIds) ? allowedRoleIds : [],
      },
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: tenant,
      entityType: 'workflow_step',
      entityId: step.id,
      action: 'workflow_step.create',
      userId: auditActor(req),
      oldValues: null,
      newValues: { workflowId: req.params.id, key: step.key, name: step.name, position: step.position },
      metadata: {},
    });
    res.status(201).json({ step });
  } catch (e) {
    next(e);
  }
}

export async function updateStep(req, res, next) {
  try {
    const tenant = tenantId(req);
    await assertDraft(req.params.id, tenant);
    const step = await prisma.workflowStep.findFirst({
      where: { id: req.params.stepId, workflowId: req.params.id },
    });
    if (!step) throw new NotFoundError('Step');
    const { key, name, description, isInitial, isFinal, position, allowedRoleIds } = req.body;
    const updated = await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        ...(key !== undefined && { key }),
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isInitial !== undefined && { isInitial: Boolean(isInitial) }),
        ...(isFinal !== undefined && { isFinal: Boolean(isFinal) }),
        ...(position !== undefined && { position }),
        ...(allowedRoleIds !== undefined && { allowedRoleIds: allowedRoleIds || [] }),
      },
    });
    const oldValues = {};
    const newValues = {};
    if (key !== undefined) {
      oldValues.key = step.key;
      newValues.key = updated.key;
    }
    if (name !== undefined) {
      oldValues.name = step.name;
      newValues.name = updated.name;
    }
    if (description !== undefined) {
      oldValues.description = step.description ?? null;
      newValues.description = updated.description ?? null;
    }
    if (isInitial !== undefined) {
      oldValues.isInitial = step.isInitial;
      newValues.isInitial = updated.isInitial;
    }
    if (isFinal !== undefined) {
      oldValues.isFinal = step.isFinal;
      newValues.isFinal = updated.isFinal;
    }
    if (position !== undefined) {
      oldValues.position = step.position;
      newValues.position = updated.position;
    }
    if (allowedRoleIds !== undefined) {
      oldValues.allowedRoleIds = step.allowedRoleIds;
      newValues.allowedRoleIds = updated.allowedRoleIds;
    }
    if (Object.keys(oldValues).length > 0) {
      await eventBus.publish(TOPICS.AUDIT_LOG, {
        tenantId: tenant,
        entityType: 'workflow_step',
        entityId: step.id,
        action: 'workflow_step.update',
        userId: auditActor(req),
        oldValues,
        newValues,
        metadata: { workflowId: req.params.id },
      });
    }
    res.json({ step: updated });
  } catch (e) {
    next(e);
  }
}

export async function deleteStep(req, res, next) {
  try {
    const tenant = tenantId(req);
    await assertDraft(req.params.id, tenant);
    const step = await prisma.workflowStep.findFirst({
      where: { id: req.params.stepId, workflowId: req.params.id },
    });
    if (!step) throw new NotFoundError('Step');
    const refs = await prisma.workflowTransition.count({
      where: { workflowId: req.params.id, OR: [{ fromStepId: step.id }, { toStepId: step.id }] },
    });
    if (refs) throw new ValidationError('Cannot delete step referenced by transitions');
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: tenant,
      entityType: 'workflow_step',
      entityId: step.id,
      action: 'workflow_step.delete',
      userId: auditActor(req),
      oldValues: { key: step.key, name: step.name, workflowId: req.params.id },
      newValues: { deleted: true },
      metadata: {},
    });
    await prisma.workflowStep.delete({ where: { id: step.id } });
    res.json({ message: 'Step deleted' });
  } catch (e) {
    next(e);
  }
}
