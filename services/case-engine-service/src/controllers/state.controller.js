import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import { readableCaseConditions } from '../utils/tenant-scope.js';
import { fetchWorkflowFull } from '../services/workflow.client.js';
import { parseRoleIds } from '../services/transition.engine.js';
import {
  buildWorkflowGuideFromFull,
  transitionTimingForClient,
} from '../utils/workflow-state.helpers.js';

function tenantHeader(req) {
  const t = req.headers['x-tenant-id'];
  if (!t) throw new ValidationError('x-tenant-id header required');
  return String(t);
}

function forwardHeaders(req) {
  const h = {};
  if (req.headers['x-user-id']) h['x-user-id'] = String(req.headers['x-user-id']);
  if (req.headers['x-user-roles']) h['x-user-roles'] = String(req.headers['x-user-roles']);
  return h;
}

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

async function computeSenderProgress(prisma, caseRow) {
  const referralStatus = String(caseRow.referralStatus || '').toLowerCase();
  const stageMap = {
    received: 'Received',
    assigned: 'Assigned',
    working: 'Being worked on',
    near: 'Near completion',
    completed: 'Completed',
    rejected: 'Rejected',
  };

  let range = stageMap.received;
  let lastUpdatedAt = caseRow.updatedAt ?? null;

  const assignment = await prisma.assignment.findFirst({
    where: {
      caseId: caseRow.id,
      assignmentType: 'referral_assignment',
      isActive: true,
    },
    select: { assignedAt: true },
    orderBy: { assignedAt: 'desc' },
  });

  const lastTransition = await prisma.caseHistory.findFirst({
    where: { caseId: caseRow.id },
    select: { transitionedAt: true },
    orderBy: { transitionedAt: 'desc' },
  });

  const currentStepFinal = caseRow.currentStepId
    ? await prisma.workflowStep.findFirst({
        where: { id: caseRow.currentStepId },
        select: { isFinal: true },
      })
    : null;

  if (referralStatus === 'rejected') {
    range = stageMap.rejected;
    lastUpdatedAt = caseRow.updatedAt ?? lastUpdatedAt;
    return { range, lastUpdatedAt };
  }
  if (referralStatus === 'returned') {
    range = stageMap.completed;
    lastUpdatedAt = caseRow.updatedAt ?? lastUpdatedAt;
    return { range, lastUpdatedAt };
  }

  if (referralStatus === 'awaiting_assignment' || referralStatus === 'pending_referral') {
    range = stageMap.received;
    lastUpdatedAt = caseRow.updatedAt ?? lastUpdatedAt;
    return { range, lastUpdatedAt };
  }

  if (referralStatus === 'in_progress') {
    if (!assignment) {
      range = stageMap.assigned;
      lastUpdatedAt = lastTransition?.transitionedAt ?? lastUpdatedAt;
      return { range, lastUpdatedAt };
    }

    const assignedAt = assignment.assignedAt;
    const transitionedAt = lastTransition?.transitionedAt ?? null;

    if (currentStepFinal?.isFinal) {
      range = stageMap.near;
    } else if (transitionedAt && assignedAt && transitionedAt > assignedAt) {
      range = stageMap.working;
    } else {
      range = stageMap.assigned;
    }

    lastUpdatedAt = transitionedAt ?? lastUpdatedAt;
    return { range, lastUpdatedAt };
  }

  return { range, lastUpdatedAt };
}

/**
 * GET /cases/:id/state — portal-shaped payload (workflowGuide, actions, history).
 */
export async function getCaseState(req, res, next) {
  try {
    const caller = tenantHeader(req);
    const userRolesStr = req.headers['x-user-roles'];
    const userRoles = userRolesStr ? String(userRolesStr).split(',').map((s) => s.trim()).filter(Boolean) : [];
    const roleIds = parseRoleIds(req);

    const caseRow = await prisma.case.findFirst({
      where: { id: req.params.id, ...readableCaseConditions(caller) },
      include: {
        currentStep: true,
      },
    });
    if (!caseRow) throw new NotFoundError('Case');

    const heldByAnotherTenant =
      Boolean(caseRow.currentTenantId) && String(caseRow.currentTenantId) !== caller;
    const receiverOwnsWorkflow =
      heldByAnotherTenant &&
      (String(caseRow.referralStatus || '').toLowerCase() === 'in_progress' ||
        String(caseRow.referralStatus || '').toLowerCase() === 'awaiting_assignment');

    // Originating/sender tenants should be able to open a referred case while another
    // agency holds custody, but they must not fetch or see the receiver's private workflow.
    if (receiverOwnsWorkflow) {
      const senderProgress = await computeSenderProgress(prisma, caseRow);
      return res.json({
        currentStep: null,
        availableActions: [],
        history: [],
        workflowGuide: null,
        senderProgress: senderProgress
          ? {
              range: senderProgress.range,
              lastUpdatedAt: senderProgress.lastUpdatedAt
                ? senderProgress.lastUpdatedAt.toISOString()
                : null,
            }
          : null,
      });
    }

    const full = await fetchWorkflowFull(caseRow.workflowId, caller, forwardHeaders(req));

    const hl = req.query.historyLimit ? parseInt(req.query.historyLimit, 10) : 50;
    const historyRows = await prisma.caseHistory.findMany({
      where: { caseId: caseRow.id },
      include: { transition: true, actor: true },
      orderBy: { transitionedAt: 'desc' },
      take: Math.min(hl, 100),
    });

    const historyOldestFirst = [...historyRows].reverse();
    const workflowGuide = buildWorkflowGuideFromFull(full, caseRow.currentStepId, historyOldestFirst);

    const stepsById = new Map(full.steps.map((s) => [s.id, s]));
    let stepEnteredAt = null;
    if (caseRow.currentStepId) {
      stepEnteredAt = await getStepEnteredAt(caseRow.id, caseRow.currentStepId);
    }

    const outgoing = full.transitions.filter((t) => t.fromStepId === caseRow.currentStepId);
    const availableActions = outgoing
      .filter((t) => {
        if (!t.allowedRoleIds?.length) return true;
        return t.allowedRoleIds.some((r) => userRoles.includes(r) || roleIds.includes(r));
      })
      .map((t) => {
        const toStep = stepsById.get(t.toStepId);
        return {
          id: t.id,
          name: t.name,
          toStepId: t.toStepId,
          requiresComment: Boolean(t.requiresComment),
          allowedRoleIds: t.allowedRoleIds || [],
          toStep: toStep
            ? { id: toStep.id, name: toStep.name, key: toStep.key }
            : null,
          ...transitionTimingForClient(t, stepEnteredAt),
        };
      });

    const history = await enrichHistoryForPortal(historyRows);

    const currentStep = caseRow.currentStep
      ? {
          id: caseRow.currentStep.id,
          name: caseRow.currentStep.name,
          key: caseRow.currentStep.key,
          isInitial: caseRow.currentStep.isInitial,
          isFinal: caseRow.currentStep.isFinal,
          requiresAttachment: Boolean(caseRow.currentStep.requiresAttachment),
          allowedRoleIds: caseRow.currentStep.allowedRoleIds || [],
        }
      : null;

    res.json({
      currentStep,
      availableActions,
      history,
      workflowGuide,
    });
  } catch (e) {
    next(e);
  }
}

async function enrichHistoryForPortal(historyRows) {
  if (!historyRows?.length) return [];
  const ids = new Set();
  for (const h of historyRows) {
    if (h.fromStepId) ids.add(h.fromStepId);
    if (h.toStepId) ids.add(h.toStepId);
  }
  const steps =
    ids.size > 0
      ? await prisma.workflowStep.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, name: true, key: true },
        })
      : [];
  const map = Object.fromEntries(steps.map((s) => [s.id, s]));

  return historyRows.map((h) => ({
    id: h.id,
    transition: h.transition ? { id: h.transition.id, name: h.transition.name } : null,
    actor: h.actor
      ? {
          id: h.actor.id,
          firstName: h.actor.firstName,
          lastName: h.actor.lastName,
          email: h.actor.email,
        }
      : null,
    comment: h.comment,
    transitionedAt: h.transitionedAt.toISOString(),
    fromStep: h.fromStepId ? map[h.fromStepId] ?? null : null,
    toStep: h.toStepId ? map[h.toStepId] ?? null : null,
  }));
}
