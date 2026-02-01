import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../shared/common/errors.js';
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');

export async function getWorkflows(req, res, next) {
  try {
    const { tenantId, isActive } = req.query;
    const workflows = await prisma.workflow.findMany({
      where: {
        ...(tenantId && { tenantId }),
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
      },
      include: {
        tenant: true,
        creator: true,
      },
    });
    res.json({ workflows });
  } catch (error) {
    next(error);
  }
}

export async function getWorkflow(req, res, next) {
  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        creator: true,
        workflowStates: true,
      },
    });
    if (!workflow) throw new NotFoundError('Workflow');
    res.json({ workflow });
  } catch (error) {
    next(error);
  }
}

export async function createWorkflow(req, res, next) {
  try {
    const workflow = await prisma.workflow.create({
      data: req.body,
      include: {
        tenant: true,
        creator: true,
      },
    });
    await eventBus.publish('workflow.created', { workflowId: workflow.id, tenantId: workflow.tenantId });
    res.status(201).json({ workflow });
  } catch (error) {
    next(error);
  }
}

export async function updateWorkflow(req, res, next) {
  try {
    const workflow = await prisma.workflow.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await eventBus.publish('workflow.updated', { workflowId: workflow.id });
    res.json({ workflow });
  } catch (error) {
    next(error);
  }
}

export async function deleteWorkflow(req, res, next) {
  try {
    await prisma.workflow.delete({ where: { id: req.params.id } });
    res.json({ message: 'Workflow deleted' });
  } catch (error) {
    next(error);
  }
}

export async function getWorkflowStates(req, res, next) {
  try {
    const { caseId, workflowId } = req.query;
    const states = await prisma.workflowState.findMany({
      where: {
        ...(caseId && { caseId }),
        ...(workflowId && { workflowId }),
      },
      include: {
        case: true,
        workflow: true,
        transitioner: true,
      },
      orderBy: {
        transitionedAt: 'desc',
      },
    });
    res.json({ states });
  } catch (error) {
    next(error);
  }
}

export async function createWorkflowState(req, res, next) {
  try {
    const state = await prisma.workflowState.create({
      data: req.body,
      include: {
        case: true,
        workflow: true,
        transitioner: true,
      },
    });
    await eventBus.publish('workflow.state.changed', {
      caseId: state.caseId,
      workflowId: state.workflowId,
      currentState: state.currentState,
    });
    res.status(201).json({ state });
  } catch (error) {
    next(error);
  }
}

