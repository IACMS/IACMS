import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import { validateDefinition } from '../../../../shared/lib/workflowDefinition.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'case-service');

/** @param {import('@prisma/client').Case & { tenant?: import('@prisma/client').Tenant | null; creator?: import('@prisma/client').User | null; assignee?: import('@prisma/client').User | null }} case_ */
function caseEventPayload(case_) {
  return {
    caseId: case_.id,
    tenantId: case_.tenantId,
    caseNumber: case_.caseNumber,
    title: case_.title,
    tenantCode: case_.tenant?.code ?? null,
    creatorEmail: case_.creator?.email ?? null,
    creatorFirstName: case_.creator?.firstName ?? null,
    assigneeEmail: case_.assignee?.email ?? null,
    assigneeFirstName: case_.assignee?.firstName ?? null,
  };
}

export async function getCases(req, res, next) {
  try {
    const { tenantId, status, type, assignedTo } = req.query;
    const cases = await prisma.case.findMany({
      where: {
        ...(tenantId && { tenantId }),
        ...(status && { status }),
        ...(type && { type }),
        ...(assignedTo && { assignedTo }),
      },
      include: {
        tenant: true,
        assignee: true,
        creator: true,
      },
    });
    res.json({ cases });
  } catch (error) {
    next(error);
  }
}

export async function getCase(req, res, next) {
  try {
    const case_ = await prisma.case.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        assignee: true,
        creator: true,
        attachments: true,
      },
    });
    if (!case_) throw new NotFoundError('Case');
    res.json({ case: case_ });
  } catch (error) {
    next(error);
  }
}

export async function createCase(req, res, next) {
  try {
    if (req.body?.workflowId) {
      const { workflowId, tenantId } = req.body;
      if (!tenantId) {
        throw new ValidationError('tenantId is required when workflowId is set');
      }
      const case_ = await prisma.$transaction(async (tx) => {
        const workflow = await tx.workflow.findFirst({
          where: { id: workflowId, tenantId },
        });
        if (!workflow) {
          throw new NotFoundError('Workflow');
        }
        if (!workflow.isActive) {
          throw new ValidationError('Workflow is not active');
        }
        const def = /** @type {Record<string, unknown>} */ (workflow.definition);
        validateDefinition(def);
        const initialState = def.initialState;
        const { workflowId: _w, status: _s, ...rest } = req.body;
        const data = { ...rest, workflowId, status: String(initialState) };
        const created = await tx.case.create({
          data,
          include: {
            tenant: true,
            creator: true,
            assignee: true,
          },
        });
        await tx.workflowState.create({
          data: {
            caseId: created.id,
            workflowId: workflow.id,
            currentState: String(initialState),
            previousState: null,
            transitionedBy: data.createdBy,
            transitionNotes: null,
          },
        });
        return created;
      });
      await eventBus.publish(TOPICS.CASE_CREATED, caseEventPayload(case_));
      return res.status(201).json({ case: case_ });
    }

    const case_ = await prisma.case.create({
      data: req.body,
      include: {
        tenant: true,
        creator: true,
        assignee: true,
      },
    });
    await eventBus.publish(TOPICS.CASE_CREATED, caseEventPayload(case_));
    res.status(201).json({ case: case_ });
  } catch (error) {
    next(error);
  }
}

export async function updateCase(req, res, next) {
  try {
    await prisma.case.update({
      where: { id: req.params.id },
      data: req.body,
    });
    const full = await prisma.case.findUnique({
      where: { id: req.params.id },
      include: { tenant: true, creator: true, assignee: true },
    });
    if (full) {
      await eventBus.publish(TOPICS.CASE_UPDATED, caseEventPayload(full));
    }
    res.json({ case: full });
  } catch (error) {
    next(error);
  }
}

export async function deleteCase(req, res, next) {
  try {
    await prisma.case.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    res.json({ message: 'Case deleted' });
  } catch (error) {
    next(error);
  }
}
