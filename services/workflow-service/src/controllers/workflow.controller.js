import prisma from '../config/database.js';
import { NotFoundError, ValidationError, WorkflowNotPublishedError, WorkflowClosedError } from '../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'workflow-service');

function emitAudit(payload) {
  eventBus.publish(TOPICS.AUDIT_LOG, payload).catch(() => {});
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

export async function addTransition(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const workflowId = req.params.id;
    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, tenantId } });
    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'DRAFT') throw new ValidationError('Only DRAFT workflows can be modified');

    const transition = await prisma.workflowTransition.create({
      data: {
        ...req.body,
        workflowId
      }
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
