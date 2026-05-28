import prisma from '../config/database.js';
import {
  NotFoundError,
  ValidationError,
  WorkflowClosedError,
} from '../../../../shared/common/errors.js';
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
    const tenant = tenantId(req);
    const workflow = await prisma.workflow.findFirst({
      where: { id: req.params.id, tenantId: tenant },
      include: {
        creator: true,
        steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] },
        transitions: true,
      },
    });
    if (!workflow) throw new NotFoundError('Workflow');
    res.json({ workflow });
  } catch (e) {
    next(e);
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
  } catch (e) {
    next(e);
  }
}

export async function updateWorkflow(req, res, next) {
  try {
    const tenant = tenantId(req);
    const existing = await prisma.workflow.findFirst({ where: { id: req.params.id, tenantId: tenant } });
    if (!existing) throw new NotFoundError('Workflow');
    if (existing.status !== 'DRAFT') throw new WorkflowClosedError('Published workflows cannot be edited');

    const { name, description, definition } = req.body;
    const workflow = await prisma.workflow.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(definition !== undefined && { definition }),
      },
    });
    const oldValues = {};
    const newValues = {};
    if (name !== undefined) {
      oldValues.name = existing.name;
      newValues.name = workflow.name;
    }
    if (description !== undefined) {
      oldValues.description = existing.description ?? null;
      newValues.description = workflow.description ?? null;
    }
    if (definition !== undefined) {
      oldValues.definitionPresent = Boolean(existing.definition);
      newValues.definitionPresent = Boolean(workflow.definition);
    }
    if (Object.keys(oldValues).length > 0) {
      await eventBus.publish(TOPICS.AUDIT_LOG, {
        tenantId: tenant,
        entityType: 'workflow',
        entityId: workflow.id,
        action: 'workflow.update',
        userId: auditActor(req),
        oldValues,
        newValues,
        metadata: {},
      });
    }

    res.json({ workflow });
  } catch (e) {
    next(e);
  }
}

export async function deleteWorkflow(req, res, next) {
  try {
    const tenant = tenantId(req);
    const existing = await prisma.workflow.findFirst({
      where: { id: req.params.id, tenantId: tenant },
      select: {
        id: true,
        key: true,
        version: true,
        status: true,
        _count: { select: { cases: true } },
      },
    });
    if (!existing) throw new NotFoundError('Workflow');
    if (existing.status !== 'DRAFT') throw new WorkflowClosedError('Only draft workflows may be deleted');
    if (existing._count.cases > 0) throw new ValidationError('Workflow referenced by cases');
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: tenant,
      entityType: 'workflow',
      entityId: existing.id,
      action: 'workflow.delete',
      userId: auditActor(req),
      oldValues: { key: existing.key, version: existing.version, status: existing.status },
      newValues: { deleted: true },
      metadata: {},
    });
    await prisma.workflow.delete({ where: { id: existing.id } });
    res.json({ message: 'Workflow deleted' });
  } catch (e) {
    next(e);
  }
}

export async function publishWorkflow(req, res, next) {
  try {
    const tenant = tenantId(req);
    const wf = await prisma.workflow.findFirst({
      where: { id: req.params.id, tenantId: tenant },
      include: {
        steps: true,
        transitions: true,
      },
    });
    if (!wf) throw new NotFoundError('Workflow');
    if (wf.status !== 'DRAFT') throw new WorkflowClosedError('Workflow already published');
    assertPublishable(wf);

    await prisma.workflow.update({
      where: { id: wf.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        definition: wf.definition ?? toFullJson(wf),
      },
    });

    const published = await prisma.workflow.findUnique({
      where: { id: wf.id },
      include: {
        steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] },
        transitions: true,
      },
    });
    const full = toFullJson(published);
    await setCachedWorkflowFull(wf.id, full);

    await eventBus.publish(TOPICS.WORKFLOW_PUBLISHED, {
      workflowId: wf.id,
      tenantId: wf.tenantId,
      key: wf.key,
      version: wf.version,
      publishedAt: published.publishedAt.toISOString(),
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: tenant,
      entityType: 'workflow',
      entityId: wf.id,
      action: 'workflow.publish',
      userId: auditActor(req),
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'PUBLISHED', publishedAt: published.publishedAt.toISOString() },
    });

    res.json({ workflow: published });
  } catch (e) {
    if (e.code === 'WORKFLOW_NOT_PUBLISHABLE') {
      return next(new ValidationError(e.message));
    }
    next(e);
  }
}

export async function newWorkflowVersion(req, res, next) {
  try {
    const tenant = tenantId(req);
    const src = await prisma.workflow.findFirst({
      where: { id: req.params.id, tenantId: tenant },
      include: {
        steps: true,
        transitions: true,
      },
    });
    if (!src) throw new NotFoundError('Workflow');
    if (src.status === 'ARCHIVED') throw new WorkflowClosedError('Cannot fork an archived workflow');

    const maxRow = await prisma.workflow.findFirst({
      where: { tenantId: tenant, key: src.key },
      orderBy: { version: 'desc' },
    });

    const newVersion = (maxRow?.version || src.version) + 1;

    const newWf = await prisma.$transaction(async tx => {
      const w = await tx.workflow.create({
        data: {
          tenantId: tenant,
          key: src.key,
          name: src.name,
          description: src.description,
          version: newVersion,
          status: 'DRAFT',
          definition: src.definition,
          createdBy: req.body.createdBy || src.createdBy,
        },
      });
      const idMap = new Map();
      for (const s of src.steps) {
        const ns = await tx.workflowStep.create({
          data: {
            workflowId: w.id,
            key: s.key,
            name: s.name,
            description: s.description,
            isInitial: s.isInitial,
            isFinal: s.isFinal,
            position: s.position,
            allowedRoleIds: [...s.allowedRoleIds],
          },
        });
        idMap.set(s.id, ns.id);
      }
      for (const t of src.transitions) {
        await tx.workflowTransition.create({
          data: {
            workflowId: w.id,
            name: t.name,
            description: t.description,
            fromStepId: idMap.get(t.fromStepId),
            toStepId: idMap.get(t.toStepId),
            allowedRoleIds: [...t.allowedRoleIds],
            requiresComment: t.requiresComment,
            requiresAttachment: t.requiresAttachment,
          },
        });
      }
      return w;
    });

    const out = await prisma.workflow.findUnique({
      where: { id: newWf.id },
      include: {
        steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] },
        transitions: true,
      },
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: tenant,
      entityType: 'workflow',
      entityId: newWf.id,
      action: 'workflow.new_version',
      userId: auditActor(req),
      oldValues: { sourceWorkflowId: src.id, sourceVersion: src.version },
      newValues: { version: newWf.version, status: newWf.status },
      metadata: {},
    });

    res.status(201).json({ workflow: out });
  } catch (e) {
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
