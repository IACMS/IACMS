import prisma from '../config/database.js';
import { NotFoundError, ValidationError, WorkflowNotPublishedError, WorkflowClosedError } from '../../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'workflow-service');

function emitAudit(payload) {
  eventBus.publish(TOPICS.AUDIT_LOG, payload).catch(() => {});
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ timeLimitType: string, timeLimitAmount: number | null, timeLimitUnit: string | null }}
 */
function parseTransitionTimeLimits(body) {
  const b = body && typeof body === 'object' ? body : {};
  const rawType = b.timeLimitType;
  const t =
    rawType === 'RECOMMENDATION' || rawType === 'DEADLINE'
      ? rawType
      : rawType === 'NONE' || rawType == null || rawType === ''
        ? 'NONE'
        : null;
  if (t === null) {
    throw new ValidationError('timeLimitType must be NONE, RECOMMENDATION, or DEADLINE');
  }

  if (t === 'NONE') {
    return { timeLimitType: 'NONE', timeLimitAmount: null, timeLimitUnit: null };
  }

  let amount = null;
  if (b.timeLimitAmount != null && b.timeLimitAmount !== '') {
    const n = parseInt(String(b.timeLimitAmount), 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new ValidationError('timeLimitAmount must be a positive integer');
    }
    amount = n;
  }

  const rawUnit = b.timeLimitUnit;
  const unit = rawUnit === 'HOURS' || rawUnit === 'DAYS' ? rawUnit : null;

  if (!amount || !unit) {
    throw new ValidationError(
      'timeLimitAmount and timeLimitUnit (HOURS or DAYS) are required when timeLimitType is RECOMMENDATION or DEADLINE',
    );
  }
  return { timeLimitType: t, timeLimitAmount: amount, timeLimitUnit: unit };
}

export async function getWorkflows(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) throw new ValidationError('Tenant ID is required');
    const { status } = req.query;
    const workflows = await prisma.workflow.findMany({
      where: {
        tenantId,
        ...(status && { status }),
      },
    });
    res.json({ workflows });
  } catch (error) {
    next(error);
  }
}

export async function getWorkflow(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) throw new ValidationError('Tenant ID is required');
    const workflow = await prisma.workflow.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!workflow) throw new NotFoundError('Workflow');
    res.json({ workflow });
  } catch (error) {
    next(error);
  }
}

export async function getFullWorkflow(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) throw new ValidationError('Tenant ID is required');
    const workflow = await prisma.workflow.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        steps: true,
        transitions: true,
      }
    });
    if (!workflow) throw new NotFoundError('Workflow');
    res.json({ workflow });
  } catch (error) {
    next(error);
  }
}

export async function getPublishedWorkflow(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { key } = req.query;
    if (!key || !tenantId) {
      throw new ValidationError('key and tenantId are required');
    }
    const workflow = await prisma.workflow.findFirst({
      where: { key, tenantId, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      include: { steps: true, transitions: true }
    });
    if (!workflow) throw new NotFoundError('Published Workflow');
    res.json({ workflow });
  } catch (error) {
    next(error);
  }
}

export async function createWorkflow(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorId = req.headers['x-user-id'];
    const { name, key, description, createdBy } = req.body;
    if (!name || !key || !tenantId) throw new ValidationError('name, key, tenantId are required');
    const workflow = await prisma.workflow.create({
      data: {
        name,
        key,
        description,
        tenantId,
        createdBy: createdBy || actorId || undefined,
        status: 'DRAFT',
        version: 1
      },
    });
    await eventBus.publish(TOPICS.WORKFLOW_CREATED, { workflowId: workflow.id, tenantId: workflow.tenantId });
    emitAudit({
      tenantId,
      entityType: 'workflow',
      entityId: workflow.id,
      action: 'workflow_created',
      userId: actorId || createdBy || null,
      metadata: { key: workflow.key, name: workflow.name },
    });
    res.status(201).json({ workflow });
  } catch (error) {
    next(error);
  }
}

export async function updateWorkflow(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorId = req.headers['x-user-id'];
    const workflow = await prisma.workflow.findFirst({ where: { id: req.params.id, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be updated');

    const updated = await prisma.workflow.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        description: req.body.description,
        definition: req.body.definition
      },
    });
    await eventBus.publish(TOPICS.WORKFLOW_UPDATED, { workflowId: updated.id });
    emitAudit({
      tenantId,
      entityType: 'workflow',
      entityId: updated.id,
      action: 'workflow_updated',
      userId: actorId || null,
      metadata: { fields: Object.keys(req.body || {}) },
    });
    res.json({ workflow: updated });
  } catch (error) {
    next(error);
  }
}

export async function addStep(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const workflowId = req.params.id;
    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be modified');

    const step = await prisma.workflowStep.create({
      data: {
        ...req.body,
        workflowId
      }
    });
    res.status(201).json({ step });
  } catch (error) {
    next(error);
  }
}

export async function updateStep(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { id, stepId } = req.params;
    const workflow = await prisma.workflow.findFirst({ where: { id, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be modified');

    const step = await prisma.workflowStep.update({
      where: { id: stepId },
      data: req.body
    });
    res.json({ step });
  } catch (error) {
    next(error);
  }
}

export async function deleteStep(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { id, stepId } = req.params;
    const workflow = await prisma.workflow.findFirst({ where: { id, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be modified');

    await prisma.workflowStep.delete({ where: { id: stepId } });
    res.json({ message: 'Step deleted' });
  } catch (error) {
    next(error);
  }
}

/**
 * Resolve fromStepId (direct or via fromTransitionId = parent transition's destination)
 * and toStepId (explicit or single final step when terminal=true).
 */
async function resolveTransitionEndpoints(workflowId, body) {
  const workflowFull = await prisma.workflow.findFirst({
    where: { id: workflowId },
    include: { steps: true },
  });
  if (!workflowFull) throw new NotFoundError('Workflow');

  const stepIds = new Set(workflowFull.steps.map((s) => s.id));

  let fromStepId = body.fromStepId;
  if (body.fromTransitionId) {
    const parent = await prisma.workflowTransition.findFirst({
      where: { id: body.fromTransitionId, workflowId },
    });
    if (!parent) {
      throw new ValidationError('fromTransitionId must reference a transition in this workflow');
    }
    fromStepId = parent.toStepId;
  }
  if (!fromStepId) {
    throw new ValidationError('Provide fromStepId or fromTransitionId');
  }
  if (!stepIds.has(fromStepId)) {
    throw new ValidationError('fromStepId must belong to this workflow');
  }

  const terminal = body.terminal === true || body.terminal === 'true';
  let toStepId = body.toStepId;
  if (typeof toStepId === 'string' && toStepId.trim() === '') {
    toStepId = undefined;
  }

  if (!toStepId) {
    if (!terminal) {
      throw new ValidationError(
        'toStepId is required unless terminal is true (closing transition to the sole final step)',
      );
    }
    const finals = workflowFull.steps.filter((s) => s.isFinal);
    if (finals.length !== 1) {
      throw new ValidationError(
        'Closing transitions without toStepId require exactly one final step in this workflow, or set toStepId explicitly',
      );
    }
    toStepId = finals[0].id;
  }

  if (!stepIds.has(toStepId)) {
    throw new ValidationError('toStepId must belong to this workflow');
  }
  if (fromStepId === toStepId) {
    throw new ValidationError('From and to steps must differ');
  }

  return { fromStepId, toStepId };
}

export async function addTransition(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const workflowId = req.params.id;
    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be modified');

    const { name, description, requiresComment, allowedRoleIds } = req.body || {};
    if (!name || typeof name !== 'string') {
      throw new ValidationError('name is required');
    }

    const tl = parseTransitionTimeLimits(req.body || {});

    const { fromStepId, toStepId } = await resolveTransitionEndpoints(workflowId, req.body);
    const trimmedName = name.trim();

    const dup = await prisma.workflowTransition.findFirst({
      where: { workflowId, fromStepId, name: trimmedName },
    });
    if (dup) {
      throw new ValidationError('Another transition with this name already exists from that step');
    }

    const transition = await prisma.workflowTransition.create({
      data: {
        workflowId,
        fromStepId,
        toStepId,
        name: trimmedName,
        description: description ?? undefined,
        requiresComment: Boolean(requiresComment),
        allowedRoleIds: Array.isArray(allowedRoleIds) ? allowedRoleIds : [],
        timeLimitType: tl.timeLimitType,
        timeLimitAmount: tl.timeLimitAmount,
        timeLimitUnit: tl.timeLimitUnit,
      },
    });
    res.status(201).json({ transition });
  } catch (error) {
    next(error);
  }
}

export async function deleteTransition(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { id, transitionId } = req.params;
    const workflow = await prisma.workflow.findFirst({ where: { id, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be modified');

    await prisma.workflowTransition.delete({ where: { id: transitionId } });
    res.json({ message: 'Transition deleted' });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /workflows/:id/new-version
 * Clones a workflow (any status) into a new DRAFT row with version = max(key)+1, copying steps and transitions with new IDs.
 */
export async function createWorkflowNewVersion(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorId = req.headers['x-user-id'];
    const sourceId = req.params.id;

    const source = await prisma.workflow.findFirst({
      where: { id: sourceId, tenantId },
      include: { steps: true, transitions: true },
    });
    if (!source) throw new NotFoundError('Workflow');

    const existingDraft = await prisma.workflow.findFirst({
      where: { tenantId, key: source.key, status: 'DRAFT' },
    });
    if (existingDraft) {
      throw new ValidationError(
        `A draft already exists for workflow key "${source.key}" (v${existingDraft.version}). Edit or publish that draft before creating another version.`,
      );
    }

    const agg = await prisma.workflow.aggregate({
      where: { tenantId, key: source.key },
      _max: { version: true },
    });
    const nextVersion = (agg._max.version ?? 0) + 1;

    const newWf = await prisma.$transaction(async (tx) => {
      const wf = await tx.workflow.create({
        data: {
          tenantId,
          key: source.key,
          name: source.name,
          description: source.description,
          definition: source.definition ?? undefined,
          version: nextVersion,
          status: 'DRAFT',
          isDefault: false,
          isActive: true,
          createdBy: actorId || undefined,
        },
      });

      const stepMap = new Map();
      for (const s of source.steps) {
        const row = await tx.workflowStep.create({
          data: {
            workflowId: wf.id,
            key: s.key,
            name: s.name,
            description: s.description,
            isInitial: s.isInitial,
            isFinal: s.isFinal,
            position: s.position,
            allowedRoleIds: Array.isArray(s.allowedRoleIds) ? s.allowedRoleIds : [],
          },
        });
        stepMap.set(s.id, row.id);
      }

      for (const t of source.transitions) {
        const fromId = stepMap.get(t.fromStepId);
        const toId = stepMap.get(t.toStepId);
        if (!fromId || !toId) continue;
        await tx.workflowTransition.create({
          data: {
            workflowId: wf.id,
            fromStepId: fromId,
            toStepId: toId,
            name: t.name,
            description: t.description,
            allowedRoleIds: Array.isArray(t.allowedRoleIds) ? t.allowedRoleIds : [],
            requiresComment: t.requiresComment,
            timeLimitType: t.timeLimitType ?? 'NONE',
            timeLimitAmount: t.timeLimitAmount ?? null,
            timeLimitUnit: t.timeLimitUnit ?? null,
          },
        });
      }

      return wf;
    });

    await eventBus.publish(TOPICS.WORKFLOW_CREATED, { workflowId: newWf.id, tenantId: newWf.tenantId });
    emitAudit({
      tenantId,
      entityType: 'workflow',
      entityId: newWf.id,
      action: 'workflow_version_draft_created',
      userId: actorId || null,
      metadata: { fromWorkflowId: sourceId, key: source.key, version: newWf.version },
    });

    res.status(201).json({ workflow: newWf });
  } catch (error) {
    next(error);
  }
}

/** DELETE /workflows/:id — remove a DRAFT with no cases (abandon new version). */
export async function deleteWorkflow(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorId = req.headers['x-user-id'];
    const workflowId = req.params.id;

    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') {
      throw new ValidationError('Only DRAFT workflows can be deleted');
    }

    const caseCount = await prisma.case.count({ where: { workflowId } });
    if (caseCount > 0) {
      throw new ValidationError('Cannot delete a workflow that has cases; archive it instead.');
    }

    await prisma.workflow.delete({ where: { id: workflowId } });

    emitAudit({
      tenantId,
      entityType: 'workflow',
      entityId: workflowId,
      action: 'workflow_deleted',
      userId: actorId || null,
      metadata: { key: workflow.key, version: workflow.version },
    });

    res.json({ message: 'Workflow deleted' });
  } catch (error) {
    next(error);
  }
}

export async function updateTransition(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorId = req.headers['x-user-id'];
    const { id, transitionId } = req.params;

    const workflow = await prisma.workflow.findFirst({ where: { id, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be modified');

    const existing = await prisma.workflowTransition.findFirst({
      where: { id: transitionId, workflowId: id },
    });
    if (!existing) throw new NotFoundError('Transition');

    const b = req.body || {};
    const data = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.description !== undefined) data.description = b.description;
    if (b.requiresComment !== undefined) data.requiresComment = b.requiresComment;
    if (b.allowedRoleIds !== undefined) data.allowedRoleIds = b.allowedRoleIds;

    if (
      'timeLimitType' in b ||
      'timeLimitAmount' in b ||
      'timeLimitUnit' in b
    ) {
      const merged = {
        timeLimitType: 'timeLimitType' in b ? b.timeLimitType : existing.timeLimitType,
        timeLimitAmount: 'timeLimitAmount' in b ? b.timeLimitAmount : existing.timeLimitAmount,
        timeLimitUnit: 'timeLimitUnit' in b ? b.timeLimitUnit : existing.timeLimitUnit,
      };
      const tl = parseTransitionTimeLimits(merged);
      data.timeLimitType = tl.timeLimitType;
      data.timeLimitAmount = tl.timeLimitAmount;
      data.timeLimitUnit = tl.timeLimitUnit;
    }

    let nextFrom = existing.fromStepId;
    if (b.fromTransitionId) {
      const parent = await prisma.workflowTransition.findFirst({
        where: { id: b.fromTransitionId, workflowId: id },
      });
      if (!parent) throw new ValidationError('fromTransitionId must reference a transition in this workflow');
      data.fromStepId = parent.toStepId;
      nextFrom = parent.toStepId;
    } else if (b.fromStepId !== undefined) {
      data.fromStepId = b.fromStepId;
      nextFrom = b.fromStepId;
    }

    let nextTo = existing.toStepId;
    const terminal = b.terminal === true || b.terminal === 'true';
    let toProvided = b.toStepId;
    if (typeof toProvided === 'string' && toProvided.trim() === '') toProvided = undefined;

    if (terminal && (toProvided === undefined || toProvided === null)) {
      const wfSteps = await prisma.workflowStep.findMany({ where: { workflowId: id } });
      const finals = wfSteps.filter((s) => s.isFinal);
      if (finals.length !== 1) {
        throw new ValidationError(
          'Closing transitions without toStepId require exactly one final step, or set toStepId explicitly',
        );
      }
      data.toStepId = finals[0].id;
      nextTo = finals[0].id;
    } else if (toProvided !== undefined && toProvided !== null) {
      data.toStepId = toProvided;
      nextTo = toProvided;
    }

    if (data.fromStepId || data.toStepId) {
      const fromId = data.fromStepId ?? existing.fromStepId;
      const toId = data.toStepId ?? existing.toStepId;
      if (fromId === toId) throw new ValidationError('From and to steps must differ');
      const steps = await prisma.workflowStep.count({
        where: { workflowId: id, id: { in: [fromId, toId] } },
      });
      if (steps !== 2) throw new ValidationError('fromStepId and toStepId must belong to this workflow');
    }

    const nextName = data.name !== undefined ? data.name : existing.name;
    if (nextName !== existing.name || nextFrom !== existing.fromStepId) {
      const dup = await prisma.workflowTransition.findFirst({
        where: {
          workflowId: id,
          fromStepId: nextFrom,
          name: nextName,
          NOT: { id: transitionId },
        },
      });
      if (dup) throw new ValidationError('Another transition with this name already exists from that step');
    }

    if (Object.keys(data).length === 0) {
      const transition = await prisma.workflowTransition.findUnique({ where: { id: transitionId } });
      return res.json({ transition });
    }

    const transition = await prisma.workflowTransition.update({
      where: { id: transitionId },
      data,
    });

    emitAudit({
      tenantId,
      entityType: 'workflow',
      entityId: id,
      action: 'workflow_transition_updated',
      userId: actorId || null,
      metadata: { transitionId },
    });

    res.json({ transition });
  } catch (error) {
    next(error);
  }
}

export async function publishWorkflow(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const workflowId = req.params.id;
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, tenantId },
      include: { steps: true, transitions: true }
    });
    
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Workflow is already published or archived');

    // Business Invariant: Must have exactly one initial step
    const initialSteps = workflow.steps.filter(s => s.isInitial);
    if (initialSteps.length !== 1) {
      throw new ValidationError(`Workflow must have exactly one initial step. Found ${initialSteps.length}.`);
    }

    await prisma.workflow.updateMany({
      where: {
        tenantId,
        key: workflow.key,
        status: 'PUBLISHED',
        id: { not: workflowId },
      },
      data: { status: 'ARCHIVED' },
    });

    const updated = await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }
    });

    await eventBus.publish(TOPICS.WORKFLOW_PUBLISHED, {
      workflowId: updated.id,
      tenantId: updated.tenantId,
      key: updated.key,
    });
    const actorId = req.headers['x-user-id'];
    emitAudit({
      tenantId,
      entityType: 'workflow',
      entityId: updated.id,
      action: 'workflow_published',
      userId: actorId || null,
      metadata: { key: updated.key, version: updated.version },
    });
    res.json({ workflow: updated });
  } catch (error) {
    next(error);
  }
}
