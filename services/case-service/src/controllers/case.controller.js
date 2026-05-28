import prisma from '../config/database.js';
import {
  NotFoundError,
  ValidationError,
  TenantMismatchError,
  WorkflowNotPublishedError,
} from '../../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';
import { readableCaseConditions, writableCaseWhere } from '../utils/tenant-scope.js';
import { generateCaseNumber } from '../utils/case-number.js';
import { fetchPublishedWorkflow } from '../services/workflow.client.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'case-service');

function tenantId(req) {
  const t = req.headers['x-tenant-id'];
  if (!t) throw new ValidationError('x-tenant-id header required');
  return String(t);
}

function forwardHeaders(req) {
  const h = {};
  if (req.headers['x-user-id']) h['x-user-id'] = String(req.headers['x-user-id']);
  return h;
}

function actorUserId(req, fallback) {
  const raw = req.headers['x-user-id'] || fallback;
  return raw ? String(raw) : null;
}

export async function getCases(req, res, next) {
  try {
    const caller = tenantId(req);
    const { workflowKey, status, assignedTo, page = '1', pageSize = '50' } = req.query;
    const take = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;

    const where = {
      ...readableCaseConditions(caller),
      ...(status && { status }),
      ...(assignedTo && { assignedTo }),
    };

    if (workflowKey) {
      const wf = await prisma.workflow.findFirst({
        where: { tenantId: caller, key: workflowKey, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
      });
      if (wf) where.workflowId = wf.id;
    }

    const cases = await prisma.case.findMany({
      where,
      include: { assignee: true, creator: true, currentStep: true },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    res.json({ cases });
  } catch (e) {
    next(e);
  }
}

export async function getCase(req, res, next) {
  try {
    const caller = tenantId(req);
    const case_ = await prisma.case.findFirst({
      where: { id: req.params.id, ...readableCaseConditions(caller) },
      include: {
        tenant: true,
        assignee: true,
        creator: true,
        attachments: true,
        currentStep: true,
        workflow: true,
      },
    });
    if (!case_) throw new NotFoundError('Case');
    res.json({ case: case_ });
  } catch (e) {
    next(e);
  }
}

export async function createCase(req, res, next) {
  try {
    const caller = tenantId(req);
    const { workflowKey, title, description, data, priority, createdBy } = req.body;
    if (!workflowKey || !title) {
      throw new ValidationError('workflowKey and title are required');
    }
    const actorId = String(req.headers['x-user-id'] || createdBy || '');
    if (!actorId) throw new ValidationError('x-user-id header required');

    let full;
    try {
      full = await fetchPublishedWorkflow(workflowKey, caller, forwardHeaders(req));
    } catch {
      throw new WorkflowNotPublishedError();
    }

    const initial = full.steps.find(s => s.isInitial);
    if (!initial) throw new WorkflowNotPublishedError('Workflow missing initial step');

    const caseNumber = await generateCaseNumber(caller);

    const case_ = await prisma.case.create({
      data: {
        tenantId: caller,
        originatingTenantId: caller,
        currentTenantId: caller,
        referralStatus: 'none',
        caseNumber,
        title,
        description,
        type: req.body.type || 'general',
        priority: priority || 'normal',
        status: 'open',
        workflowId: full.id,
        workflowVersion: full.version,
        currentStepId: initial.id,
        data: data ?? undefined,
        createdBy: actorId,
      },
      include: { currentStep: true, workflow: true, creator: true },
    });

    await prisma.caseHistory.create({
      data: {
        caseId: case_.id,
        tenantId: caller,
        transitionId: null,
        fromStepId: null,
        toStepId: initial.id,
        actorId,
        comment: null,
      },
    });

    await eventBus.publish(TOPICS.CASE_CREATED, {
      caseId: case_.id,
      tenantId: caller,
      workflowId: case_.workflowId,
      workflowVersion: case_.workflowVersion,
      caseNumber: case_.caseNumber,
      currentStepId: case_.currentStepId,
      actorId,
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: caller,
      relatedTenantId: null,
      entityType: 'case',
      entityId: case_.id,
      action: 'case.create',
      userId: actorId,
      oldValues: null,
      newValues: {
        caseNumber: case_.caseNumber,
        workflowKey,
        workflowId: case_.workflowId,
        workflowVersion: case_.workflowVersion,
        currentStepId: case_.currentStepId,
      },
    });

    res.status(201).json({ case: case_ });
  } catch (e) {
    next(e);
  }
}

export async function updateCase(req, res, next) {
  try {
    const caller = tenantId(req);
    const existing = await prisma.case.findFirst({
      where: writableCaseWhere(req.params.id, caller),
    });
    if (!existing) {
      const other = await prisma.case.findFirst({
        where: { id: req.params.id, ...readableCaseConditions(caller) },
      });
      if (other) {
        throw new TenantMismatchError(
          'Case is currently held by another tenant; you have read-only access until it is returned.',
        );
      }
      throw new NotFoundError('Case');
    }

    const { title, description, data, priority } = req.body;
    const case_ = await prisma.case.update({
      where: { id: existing.id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(data !== undefined && { data }),
        ...(priority !== undefined && { priority }),
      },
      include: { currentStep: true },
    });

    const oldValues = {};
    const newValues = {};
    if (title !== undefined) {
      oldValues.title = existing.title;
      newValues.title = case_.title;
    }
    if (description !== undefined) {
      oldValues.description = existing.description ?? null;
      newValues.description = case_.description ?? null;
    }
    if (priority !== undefined) {
      oldValues.priority = existing.priority;
      newValues.priority = case_.priority;
    }
    if (data !== undefined) {
      oldValues.dataPresent = Boolean(existing.data);
      newValues.dataPresent = Boolean(case_.data);
    }

    await eventBus.publish(TOPICS.CASE_UPDATED, { caseId: case_.id, tenantId: caller });
    if (Object.keys(oldValues).length > 0) {
      await eventBus.publish(TOPICS.AUDIT_LOG, {
        tenantId: caller,
        relatedTenantId:
          existing.originatingTenantId && existing.originatingTenantId !== caller
            ? existing.originatingTenantId
            : null,
        entityType: 'case',
        entityId: case_.id,
        action: 'case.update',
        userId: actorUserId(req, null),
        oldValues,
        newValues,
      });
    }

    res.json({ case: case_ });
  } catch (e) {
    next(e);
  }
}

export async function deleteCase(req, res, next) {
  try {
    const caller = tenantId(req);
    const existing = await prisma.case.findFirst({
      where: writableCaseWhere(req.params.id, caller),
      include: { currentStep: true },
    });
    if (!existing) {
      const other = await prisma.case.findFirst({
        where: { id: req.params.id, ...readableCaseConditions(caller) },
      });
      if (other) {
        throw new TenantMismatchError(
          'Case is currently held by another tenant; you have read-only access until it is returned.',
        );
      }
      throw new NotFoundError('Case');
    }
    if (!existing.currentStep?.isFinal) {
      throw new ValidationError('Case can only be deleted when it is in a final workflow step');
    }

    await prisma.case.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: caller,
      relatedTenantId:
        existing.originatingTenantId && existing.originatingTenantId !== caller
          ? existing.originatingTenantId
          : null,
      entityType: 'case',
      entityId: existing.id,
      action: 'case.delete',
      userId: actorUserId(req, null),
      oldValues: {
        caseNumber: existing.caseNumber,
        status: existing.status,
        referralStatus: existing.referralStatus ?? null,
      },
      newValues: { softDeleted: true },
    });

    res.json({ message: 'Case deleted' });
  } catch (e) {
    next(e);
  }
}
