import prisma from '../config/database.js';
import { NotFoundError, ValidationError, WorkflowNotPublishedError, WorkflowClosedError } from '../../../../shared/common/errors.js';
import { TOPICS } from '../../../../shared/utils/eventBus.js';
import { workflowEventBus as eventBus } from '../config/eventBus.js';
import { assertPublishable } from '../services/invariants.js';
import {
  getCachedWorkflowFull,
  setCachedWorkflowFull,
  invalidateWorkflowFull,
} from '../services/workflow.cache.js';

function tenantId(req) {
  const t = req.headers['x-tenant-id'];
  if (!t) throw new ValidationError('x-tenant-id header required');
  return t;
}

function auditActor(req) {
  const u = req.headers['x-user-id'];
  return u ? String(u) : null;
}

function toFullJson(wf) {
  const steps = [...wf.steps].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const transitions = [...wf.transitions].sort(
    (a, b) => a.fromStepId.localeCompare(b.fromStepId) || a.name.localeCompare(b.name),
  );
  return {
    id: wf.id,
    tenantId: wf.tenantId,
    name: wf.name,
    key: wf.key,
    version: wf.version,
    status: wf.status,
    publishedAt: wf.publishedAt ? wf.publishedAt.toISOString() : null,
    steps: steps.map(s => ({
      id: s.id,
      key: s.key,
      name: s.name,
      description: s.description,
      isInitial: s.isInitial,
      isFinal: s.isFinal,
      position: s.position,
      allowedRoleIds: s.allowedRoleIds,
    })),
    transitions: transitions.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      fromStepId: t.fromStepId,
      toStepId: t.toStepId,
      allowedRoleIds: t.allowedRoleIds,
      requiresComment: t.requiresComment,
    })),
  };
}

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
    const tenant = tenantId(req);
    const { status, key } = req.query;
    const workflows = await prisma.workflow.findMany({
      where: {
        tenantId: tenant,
        ...(status && { status }),
        ...(key && { key }),
      },
      include: { creator: true },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    res.json({ workflows });
  } catch (e) {
    next(e);
  }
}

export async function getPublishedWorkflow(req, res, next) {
  try {
    const { key, tenantId: qTenant } = req.query;
    if (!key) throw new ValidationError('key query param required');
    const tenant = String(qTenant || tenantId(req));
    const wf = await prisma.workflow.findFirst({
      where: { tenantId: tenant, key, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      include: {
        steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] },
        transitions: true,
      },
    });
    if (!wf) throw new NotFoundError('Published workflow');
    res.json(toFullJson(wf));
  } catch (e) {
    next(e);
  }
}

export async function getWorkflowFull(req, res, next) {
  try {
    const tenant = tenantId(req);
    const cached = await getCachedWorkflowFull(req.params.id);
    if (cached && cached.tenantId === tenant) {
      return res.json(cached);
    }
    const wf = await prisma.workflow.findFirst({
      where: { id: req.params.id, tenantId: tenant },
      include: {
        steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] },
        transitions: true,
      },
    });
    if (!wf) throw new NotFoundError('Workflow');
    const json = toFullJson(wf);
    if (wf.status === 'PUBLISHED') await setCachedWorkflowFull(wf.id, json);
    res.json(json);
  } catch (e) {
    next(e);
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



export async function createWorkflow(req, res, next) {
  try {
    const tenant = tenantId(req);
    const { key, name, description, createdBy } = req.body;
    if (!key || !name) throw new ValidationError('key and name are required');

    const existingDraft = await prisma.workflow.findFirst({
      where: { tenantId: tenant, key, status: 'DRAFT' },
    });
    if (existingDraft) throw new ValidationError('A draft workflow with this key already exists');

    const maxV = await prisma.workflow.aggregate({
      where: { tenantId: tenant, key },
      _max: { version: true },
    });
    const nextVersion = (maxV._max.version || 0) + 1;

    const wf = await prisma.workflow.create({
      data: {
        tenantId: tenant,
        key,
        name,
        description,
        version: nextVersion,
        status: 'DRAFT',
        definition: req.body.definition ?? null,
        createdBy: createdBy || null,
      },
      include: { creator: true },
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: tenant,
      entityType: 'workflow',
      entityId: wf.id,
      action: 'workflow.created',
      userId: auditActor(req) || (createdBy ? String(createdBy) : null),
      oldValues: null,
      newValues: {
        key: wf.key,
        version: wf.version,
        status: wf.status,
        name: wf.name,
      },
      metadata: {},
    });
    res.status(201).json({ workflow: wf });
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

    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId,
      entityType: 'workflow',
      entityId: workflowId,
      action: 'workflow.delete',
      userId: actorId || null,
      oldValues: { key: workflow.key, version: workflow.version, status: workflow.status },
      newValues: { deleted: true },
      metadata: {},
    });
    res.json({ message: 'Workflow deleted' });
  } catch (e) {
    next(e);
  }
}

export async function publishWorkflow(req, res, next) {
  try {
    const tenant = tenantId(req);
    const workflowId = req.params.id;

    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId: tenant,
      },
      include: {
        steps: true,
        transitions: true,
      },
    });

    if (!workflow) {
      throw new NotFoundError('Workflow');
    }

    if (workflow.status !== 'DRAFT') {
      throw new ValidationError('Workflow is already published or archived');
    }

    // Business invariant: exactly one initial step
    const initialSteps = workflow.steps.filter((s) => s.isInitial);

    if (initialSteps.length !== 1) {
      throw new ValidationError(
        `Workflow must have exactly one initial step. Found ${initialSteps.length}.`
      );
    }

    // Optional advanced validator from second branch
    if (typeof assertPublishable === 'function') {
      assertPublishable(workflow);
    }

    // Archive/retire previous published versions with same key
    await prisma.workflow.updateMany({
      where: {
        tenantId: tenant,
        key: workflow.key,
        status: 'PUBLISHED',
        id: { not: workflowId },
      },
      data: {
        status: 'ARCHIVED',
      },
    });

    await prisma.workflow.update({
      where: { id: workflow.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),

        // Keep snapshot support if schema supports it
        definition:
          workflow.definition ??
          (typeof toFullJson === 'function'
            ? toFullJson(workflow)
            : undefined),
      },
    });

    const published = await prisma.workflow.findUnique({
      where: { id: workflow.id },
      include: {
        steps: {
          orderBy: [{ position: 'asc' }, { key: 'asc' }],
        },
        transitions: true,
      },
    });

    // Optional workflow cache support
    if (
      typeof setCachedWorkflowFull === 'function' &&
      typeof toFullJson === 'function'
    ) {
      await setCachedWorkflowFull(
        workflow.id,
        toFullJson(published)
      );
    }

    await eventBus.publish(TOPICS.WORKFLOW_PUBLISHED, {
      workflowId: workflow.id,
      tenantId: workflow.tenantId,
      key: workflow.key,
      version: workflow.version,
      publishedAt: published.publishedAt.toISOString(),
    });

    emitAudit({
      tenantId: tenant,
      entityType: 'workflow',
      entityId: workflow.id,
      action: 'workflow.publish',
      userId:
        typeof auditActor === 'function'
          ? auditActor(req)
          : req.headers['x-user-id'] || null,
      oldValues: {
        status: 'DRAFT',
      },
      newValues: {
        status: 'PUBLISHED',
        publishedAt: published.publishedAt.toISOString(),
      },
    });

    res.json({ workflow: published });
  } catch (e) {
    if (e.code === 'WORKFLOW_NOT_PUBLISHABLE') {
      return next(new ValidationError(e.message));
    }

    next(e);
  }
}

export async function archiveWorkflow(req, res, next) {
  try {
    const tenant = tenantId(req);
    const wf = await prisma.workflow.findFirst({ where: { id: req.params.id, tenantId: tenant } });
    if (!wf) throw new NotFoundError('Workflow');
    if (wf.status !== 'PUBLISHED') throw new ValidationError('Only published workflows may be archived');
    const newer = await prisma.workflow.findFirst({
      where: {
        tenantId: tenant,
        key: wf.key,
        status: 'PUBLISHED',
        version: { gt: wf.version },
      },
    });
    if (!newer) throw new ValidationError('Cannot archive the latest published version for this key');

    await prisma.workflow.update({
      where: { id: wf.id },
      data: { status: 'ARCHIVED' },
    });
    await invalidateWorkflowFull(wf.id);
    await eventBus.publish(TOPICS.WORKFLOW_ARCHIVED, {
      workflowId: wf.id,
      tenantId: tenant,
      key: wf.key,
      version: wf.version,
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: tenant,
      entityType: 'workflow',
      entityId: wf.id,
      action: 'workflow.archive',
      userId: auditActor(req),
      oldValues: { status: 'PUBLISHED' },
      newValues: { status: 'ARCHIVED' },
    });
    res.json({ message: 'Workflow archived', id: wf.id });
  } catch (e) {
    next(e);
  }
}
