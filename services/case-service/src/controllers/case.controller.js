import prisma from '../config/database.js';
import { NotFoundError, ValidationError, InvalidTransitionError, TenantMismatchError, WorkflowNotPublishedError } from '../../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';
import {
  findCaseForUser,
  assertCaseReadable,
  assertCaseMutable,
  assertRegistrarMetadataEditAllowed,
} from '../security/caseAccessPolicy.js';
import { readableCaseConditions, writableCaseWhere } from '../utils/tenant-scope.js';
import { generateCaseNumber } from '../utils/case-number.js';
import { fetchPublishedWorkflow } from '../services/workflow.client.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'case-service');

function emitAudit(payload) {
  eventBus.publish(TOPICS.AUDIT_LOG, payload).catch(() => {});
}

/** When the case entered `stepId`: latest history row with toStepId === stepId, else case createdAt. */
async function getStepEnteredAt(caseId, stepId) {
  const [last, kase] = await Promise.all([
    prisma.caseHistory.findFirst({
      where: { caseId, toStepId: stepId },
      orderBy: { transitionedAt: 'desc' },
      select: { transitionedAt: true },
    }),
    prisma.case.findUnique({ where: { id: caseId }, select: { createdAt: true } }),
  ]);
  if (last?.transitionedAt) return last.transitionedAt;
  return kase?.createdAt ?? new Date();
}

function transitionDurationMs(transition) {
  const amount = transition.timeLimitAmount;
  const unit = transition.timeLimitUnit;
  if (amount == null || amount < 1 || (unit !== 'HOURS' && unit !== 'DAYS')) return null;
  if (unit === 'HOURS') return amount * 3600_000;
  return amount * 86400_000;
}

function transitionTimingForClient(transition, stepEnteredAt) {
  const type = transition.timeLimitType || 'NONE';
  const ms = transitionDurationMs(transition);
  if (!stepEnteredAt || type === 'NONE' || !ms) {
    return {
      timeLimitType: type,
      timeLimitAmount: transition.timeLimitAmount ?? null,
      timeLimitUnit: transition.timeLimitUnit ?? null,
      deadlineAt: null,
      isPastDue: false,
    };
  }
  const deadlineAt = new Date(stepEnteredAt.getTime() + ms);
  const isPastDue = Date.now() > deadlineAt.getTime();
  return {
    timeLimitType: type,
    timeLimitAmount: transition.timeLimitAmount,
    timeLimitUnit: transition.timeLimitUnit,
    deadlineAt: deadlineAt.toISOString(),
    isPastDue,
  };
}

/** Attach fromStep / toStep summaries (id, name, key) for timeline UI. */
async function enrichHistoryWithSteps(history) {
  if (!history?.length) return history;
  const ids = new Set();
  for (const h of history) {
    if (h.fromStepId) ids.add(h.fromStepId);
    if (h.toStepId) ids.add(h.toStepId);
  }
  if (ids.size === 0) return history;
  const steps = await prisma.workflowStep.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, key: true },
  });
  const map = Object.fromEntries(steps.map((s) => [s.id, s]));
  return history.map((h) => ({
    ...h,
    fromStep: h.fromStepId ? map[h.fromStepId] ?? null : null,
    toStep: h.toStepId ? map[h.toStepId] ?? null : null,
  }));
}

/**
 * Ordered checklist + edges for case UI (design order via step.position; phases from history).
 */
async function buildWorkflowGuide(case_, historyOldestFirst) {
  const wf = await prisma.workflow.findFirst({
    where: { id: case_.workflowId },
    include: { steps: true, transitions: true },
  });
  if (!wf?.steps?.length) return null;

  const leftFrom = new Set(
    (historyOldestFirst || []).filter((h) => h.fromStepId).map((h) => h.fromStepId),
  );
  const currentId = case_.currentStepId;

  const stepsSorted = [...wf.steps].sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.key.localeCompare(b.key),
  );

  const steps = stepsSorted.map((s) => ({
    id: s.id,
    name: s.name,
    key: s.key,
    position: s.position,
    isInitial: s.isInitial,
    isFinal: s.isFinal,
    requiresAttachment: Boolean(s.requiresAttachment),
    phase: s.id === currentId ? 'current' : leftFrom.has(s.id) ? 'completed' : 'upcoming',
  }));

  return {
    steps,
    transitions: wf.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      fromStepId: t.fromStepId,
      toStepId: t.toStepId,
    })),
  };
}

/** Allowlisted scalar/JSON updates only — never workflow/state/assignment from raw body. */
const CASE_METADATA_FIELDS = ['title', 'description', 'type', 'priority', 'metadata', 'dueDate'];

function pickAllowedCaseUpdates(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};
  for (const key of CASE_METADATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }
  return out;
}

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
    const userId = req.headers['x-user-id'];
    if (!userId) throw new ValidationError('User ID is required in headers');

    const case_ = await findCaseForUser(prisma, {
      tenantId: caller,
      userId: String(userId),
      caseId: req.params.id,
      include: {
        tenant: true,
        assignee: true,
        creator: true,
        attachments: {
          where: { deletedAt: null },
          orderBy: { uploadedAt: 'desc' },
        },
        workflow: {
          select: { id: true, name: true, key: true, version: true, status: true },
        },
        currentStep: {
          select: {
            id: true,
            name: true,
            key: true,
            isInitial: true,
            isFinal: true,
            allowedRoleIds: true,
            requiresAttachment: true,
          },
        },
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
    if (title !== undefined) { oldValues.title = existing.title; newValues.title = case_.title; }
    if (description !== undefined) { oldValues.description = existing.description ?? null; newValues.description = case_.description ?? null; }
    if (priority !== undefined) { oldValues.priority = existing.priority; newValues.priority = case_.priority; }
    if (data !== undefined) { oldValues.dataPresent = Boolean(existing.data); newValues.dataPresent = Boolean(case_.data); }

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

export async function executeTransition(req, res, next) {
  try {
    const { id: caseId, transitionId } = req.params;
    const { comment } = req.body;
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'];
    const userRolesStr = req.headers['x-user-roles'];
    const userRoles = userRolesStr ? userRolesStr.split(',') : [];

    if (!tenantId || !userId) throw new ValidationError('Authentication headers required');

    // 1. Fetch case with current step
    const case_ = await findCaseForUser(prisma, {
      tenantId,
      userId,
      caseId,
      include: { workflow: true },
    });

    if (!case_) throw new NotFoundError('Case');
    if (case_.closedAt) throw new ValidationError('Case is already closed');

    // 2. Fetch transition
    const transition = await prisma.workflowTransition.findUnique({
      where: { id: transitionId },
      include: { toStep: true }
    });

    if (!transition) throw new NotFoundError('Transition');

    // 3. Validate transition belongs to case workflow
    if (transition.workflowId !== case_.workflowId) {
      throw new InvalidTransitionError('Transition does not belong to this case workflow');
    }

    // 4. Validate transition from current step
    if (transition.fromStepId !== case_.currentStepId) {
      throw new InvalidTransitionError(`Transition not valid from current step`);
    }

    const fromStep = await prisma.workflowStep.findFirst({
      where: { id: case_.currentStepId, workflowId: case_.workflowId },
    });
    if (!fromStep) {
      throw new ValidationError('Current workflow step is invalid for this case');
    }

    if (transition.requiresAttachment || fromStep.requiresAttachment) {
      const attCount = await prisma.caseAttachment.count({
        where: {
          caseId,
          deletedAt: null,
          ...(fromStep.requiresAttachment ? { workflowStepId: fromStep.id } : {}),
        },
      });
      if (attCount < 1) {
        throw new ValidationError(
          'This transition requires at least one file attachment before you can move forward. Upload a document on the case (Attachments tab).',
        );
      }
    }

    if (fromStep.allowedRoleIds && fromStep.allowedRoleIds.length > 0) {
      const allowed = fromStep.allowedRoleIds.some((role) => userRoles.includes(role));
      if (!allowed) {
        throw new ValidationError('User does not have permission to act on the current workflow step');
      }
    }

    // 5. Validate roles (if transition has allowedRoleIds)
    if (transition.allowedRoleIds && transition.allowedRoleIds.length > 0) {
      const hasRole = transition.allowedRoleIds.some(role => userRoles.includes(role));
      if (!hasRole) throw new ValidationError('User does not have permission to execute this transition');
    }

    if (transition.requiresComment && !comment) {
      throw new ValidationError('This transition requires a comment');
    }

    const limitMs = transitionDurationMs(transition);
    if (transition.timeLimitType === 'DEADLINE' && limitMs != null && limitMs > 0) {
      const enteredAt = await getStepEnteredAt(caseId, case_.currentStepId);
      const deadlineMs = enteredAt.getTime() + limitMs;
      if (Date.now() > deadlineMs) {
        const amt = transition.timeLimitAmount;
        const u = transition.timeLimitUnit === 'DAYS' ? 'day(s)' : 'hour(s)';
        throw new ValidationError(
          `This transition is past its deadline (${amt} ${u} from when this step started).`,
        );
      }
    }

    // 6. Execute atomically
    const [updatedCase, history] = await prisma.$transaction([
      prisma.case.update({
        where: { id: caseId },
        data: {
          currentStepId: transition.toStepId,
          status: transition.toStep.isFinal ? 'closed' : case_.status,
          closedAt: transition.toStep.isFinal ? new Date() : null,
        }
      }),
      prisma.caseHistory.create({
        data: {
          caseId,
          tenantId,
          transitionId,
          fromStepId: case_.currentStepId,
          toStepId: transition.toStepId,
          actorId: userId,
          comment
        }
      })
    ]);

    await eventBus.publish(TOPICS.CASE_TRANSITIONED, {
      caseId,
      tenantId,
      transitionId,
      fromStepId: case_.currentStepId,
      toStepId: transition.toStepId,
    });

    emitAudit({
      tenantId,
      entityType: 'case',
      entityId: caseId,
      action: 'case_transitioned',
      userId,
      metadata: {
        transitionId,
        fromStepId: case_.currentStepId,
        toStepId: transition.toStepId,
      },
    });

    res.json({ case: updatedCase, history });
  } catch (error) {
    next(error);
  }
}

export async function getCaseHistory(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const caseId = req.params.id;

    await assertCaseReadable(prisma, req, caseId, { select: { id: true } });

    const historyRaw = await prisma.caseHistory.findMany({
      where: { caseId, tenantId },
      include: {
        transition: true,
        actor: true,
      },
      orderBy: { transitionedAt: 'desc' },
    });
    const history = await enrichHistoryWithSteps(historyRaw);

    res.json({ history });
  } catch (error) {
    next(error);
  }
}

export async function getCaseState(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const userRolesStr = req.headers['x-user-roles'];
    const userRoles = userRolesStr ? userRolesStr.split(',') : [];
    const caseId = req.params.id;
    const userId = req.headers['x-user-id'];

    const case_ = await findCaseForUser(prisma, {
      tenantId,
      userId,
      caseId,
      include: {
        currentStep: {
          select: {
            id: true,
            name: true,
            key: true,
            isInitial: true,
            isFinal: true,
            allowedRoleIds: true,
            requiresAttachment: true,
          },
        },
      },
    });

    if (!case_) throw new NotFoundError('Case');

    // Get available outgoing transitions from current step
    let availableActions = [];
    if (case_.currentStepId) {
      const stepEnteredAt = await getStepEnteredAt(caseId, case_.currentStepId);
      const transitions = await prisma.workflowTransition.findMany({
        where: { fromStepId: case_.currentStepId },
        include: { toStep: true }
      });

      // Filter by role
      availableActions = transitions
        .filter(t => {
          if (!t.allowedRoleIds || t.allowedRoleIds.length === 0) return true;
          return t.allowedRoleIds.some(role => userRoles.includes(role));
        })
        .map((t) => ({ ...t, ...transitionTimingForClient(t, stepEnteredAt) }));
    }

    const historyRaw = await prisma.caseHistory.findMany({
      where: { caseId, tenantId },
      include: { transition: true, actor: true },
      orderBy: { transitionedAt: 'desc' },
    });
    const history = await enrichHistoryWithSteps(historyRaw);

    const historyOldestFirst = [...historyRaw].reverse();
    const workflowGuide = await buildWorkflowGuide(case_, historyOldestFirst);

    res.json({
      currentStep: case_.currentStep,
      availableActions,
      history,
      workflowGuide,
    });
  } catch (error) {
    next(error);
  }
}
