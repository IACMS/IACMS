import prisma from '../config/database.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';
import {
  findTransition,
  resolveCurrentState,
  validateDefinition,
} from '../../../../shared/lib/workflowDefinition.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'workflow-service');

function workflowStateEventPayload(state, from, to, userId) {
  const c = state.case;
  const tr = state.transitioner;
  return {
    from,
    to,
    caseId: state.caseId,
    workflowId: state.workflowId,
    userId,
    caseNumber: c?.caseNumber ?? null,
    caseTitle: c?.title ?? null,
    tenantCode: c?.tenant?.code ?? null,
    transitionerEmail: tr?.email ?? null,
    transitionerFirstName: tr?.firstName ?? null,
  };
}

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
    if (req.body?.definition != null) {
      validateDefinition(req.body.definition);
    }
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
    if (req.body?.definition != null) {
      validateDefinition(req.body.definition);
    }
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

/**
 * Engine-driven case transition. Prefer this over {@link createWorkflowState} for normal use.
 */
export async function transitionCase(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'] || null;
    if (!tenantId) {
      throw new ValidationError('x-tenant-id is required');
    }
    const { to, transitionName, notes } = req.body || {};
    if (!to || typeof to !== 'string') {
      throw new ValidationError('body.to (string) is required');
    }

    const caseId = req.params.caseId;
    const case_ = await prisma.case.findUnique({ where: { id: caseId } });
    if (!case_) {
      throw new NotFoundError('Case');
    }
    if (case_.tenantId !== tenantId) {
      throw new ForbiddenError('Case does not belong to this tenant');
    }
    if (!case_.workflowId) {
      throw new ValidationError('Case has no workflow attached');
    }

    const workflow = await prisma.workflow.findFirst({
      where: { id: case_.workflowId, tenantId },
    });
    if (!workflow) {
      throw new NotFoundError('Workflow');
    }

    const def = /** @type {Record<string, unknown>} */ (workflow.definition);
    validateDefinition(def);

    const latest = await prisma.workflowState.findFirst({
      where: { caseId, workflowId: workflow.id },
      orderBy: { transitionedAt: 'desc' },
    });
    const hasStateRows = Boolean(latest);
    let fromState;
    if (hasStateRows) {
      fromState = latest.currentState;
    } else {
      fromState = resolveCurrentState(def, def.initialState, case_.status, false);
    }

    const transition = findTransition(def, fromState, to, transitionName);
    if (!transition) {
      throw new ValidationError(`No allowed transition from "${fromState}" to "${to}"`);
    }

    const newState = await prisma.$transaction(async (tx) => {
      const state = await tx.workflowState.create({
        data: {
          caseId,
          workflowId: workflow.id,
          currentState: to,
          previousState: fromState,
          transitionedBy: userId,
          transitionNotes: notes ?? null,
        },
        include: {
          case: { include: { tenant: true } },
          workflow: true,
          transitioner: true,
        },
      });
      await tx.case.update({ where: { id: caseId }, data: { status: to } });
      return state;
    });

    await eventBus.publish(TOPICS.WORKFLOW_STATE_CHANGED, workflowStateEventPayload(newState, fromState, to, userId));
    res.status(201).json({ state: newState, from: fromState, to });
  } catch (error) {
    next(error);
  }
}

export async function getWorkflowStates(req, res, next) {
  try {
    const { caseId } = req.query;
    const states = await prisma.workflowState.findMany({
      where: {
        workflowId: req.params.id,
        ...(caseId && { caseId }),
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
    const { transitionName, ...data } = req.body || {};
    if (data?.caseId && data?.workflowId && data?.currentState) {
      const case_ = await prisma.case.findUnique({ where: { id: data.caseId } });
      if (!case_ || !case_.workflowId || case_.workflowId !== data.workflowId) {
        throw new ValidationError('caseId and workflowId must match the case and its attached workflow');
      }
      const workflow = await prisma.workflow.findFirst({
        where: { id: data.workflowId, tenantId: case_.tenantId },
      });
      if (!workflow) {
        throw new NotFoundError('Workflow');
      }
      const def = /** @type {Record<string, unknown>} */ (workflow.definition);
      validateDefinition(def);
      const latest = await prisma.workflowState.findFirst({
        where: { caseId: data.caseId, workflowId: data.workflowId },
        orderBy: { transitionedAt: 'desc' },
      });
      const hasStateRows = Boolean(latest);
      let fromState;
      if (hasStateRows) {
        fromState = latest.currentState;
      } else {
        fromState = resolveCurrentState(def, def.initialState, case_.status, false);
      }
      if (data.previousState != null && data.previousState !== fromState) {
        throw new ValidationError('previousState does not match the current workflow state');
      }
      const tr = findTransition(def, fromState, data.currentState, transitionName);
      if (!tr) {
        throw new ValidationError(
          `No allowed transition from "${fromState}" to "${data.currentState}"`
        );
      }
    }
    const state = await prisma.workflowState.create({
      data,
      include: {
        case: { include: { tenant: true } },
        workflow: true,
        transitioner: true,
      },
    });
    await eventBus.publish(
      TOPICS.WORKFLOW_STATE_CHANGED,
      workflowStateEventPayload(state, state.previousState, state.currentState, state.transitionedBy),
    );
    res.status(201).json({ state });
  } catch (error) {
    next(error);
  }
}
