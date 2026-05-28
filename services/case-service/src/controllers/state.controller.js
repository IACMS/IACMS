import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import { readableCaseConditions } from '../utils/tenant-scope.js';
import { fetchWorkflowFull } from '../services/workflow.client.js';
import { parseRoleIds } from '../services/transition.engine.js';

function tenantHeader(req) {
  const t = req.headers['x-tenant-id'];
  if (!t) throw new ValidationError('x-tenant-id header required');
  return String(t);
}

function forwardHeaders(req) {
  const h = {};
  if (req.headers['x-user-id']) h['x-user-id'] = String(req.headers['x-user-id']);
  return h;
}

export async function getCaseState(req, res, next) {
  try {
    const caller = tenantHeader(req);
    const caseRow = await prisma.case.findFirst({
      where: { id: req.params.id, ...readableCaseConditions(caller) },
      include: {
        currentStep: true,
        referrals: { orderBy: { referredAt: 'desc' }, take: 5 },
      },
    });
    if (!caseRow) throw new NotFoundError('Case');

    const full = await fetchWorkflowFull(caseRow.workflowId, caller, forwardHeaders(req));
    const outgoing = full.transitions.filter(t => t.fromStepId === caseRow.currentStepId);
    const roleIds = parseRoleIds(req);
    const showAll = req.query.showAll === 'true';

    let available = outgoing;
    if (!showAll) {
      available = outgoing.filter(
        t => !t.allowedRoleIds?.length || t.allowedRoleIds.some(r => roleIds.includes(r)),
      );
    }

    const hl = req.query.historyLimit ? parseInt(req.query.historyLimit, 10) : 20;
    const ho = req.query.historyOffset ? parseInt(req.query.historyOffset, 10) : 0;

    const [historyRows, histTotal] = await Promise.all([
      prisma.caseHistory.findMany({
        where: { caseId: caseRow.id },
        orderBy: { transitionedAt: 'desc' },
        take: Math.min(hl, 100),
        skip: ho,
      }),
      prisma.caseHistory.count({ where: { caseId: caseRow.id } }),
    ]);

    const stepsById = new Map(full.steps.map(s => [s.id, s]));
    const transitionsById = new Map(full.transitions.map(t => [t.id, t]));

    const history = [...historyRows]
      .sort((a, b) => a.transitionedAt - b.transitionedAt)
      .map(h => ({
        at: h.transitionedAt.toISOString(),
        actor: { id: h.actorId, displayName: h.actorId },
        fromStep: h.fromStepId ? stepsById.get(h.fromStepId)?.name ?? null : null,
        toStep: stepsById.get(h.toStepId)?.name ?? h.toStepId,
        transition:
          h.transitionId ? transitionsById.get(h.transitionId)?.name ?? null : 'create',
        comment: h.comment,
      }));

    const responsibleRoles = (caseRow.currentStep?.allowedRoleIds || []).map(id => ({
      id,
      name: id,
    }));

    const referral = caseRow.referrals[0]
      ? {
          id: caseRow.referrals[0].id,
          status: caseRow.referrals[0].status,
          fromTenantId: caseRow.referrals[0].fromTenantId,
          toTenantId: caseRow.referrals[0].toTenantId,
        }
      : null;

    res.json({
      case: {
        id: caseRow.id,
        caseNumber: caseRow.caseNumber,
        title: caseRow.title,
        tenantId: caseRow.tenantId,
        originatingTenantId: caseRow.originatingTenantId,
        currentTenantId: caseRow.currentTenantId,
      },
      currentStep: caseRow.currentStep && {
        id: caseRow.currentStep.id,
        key: caseRow.currentStep.key,
        name: caseRow.currentStep.name,
        isFinal: caseRow.currentStep.isFinal,
      },
      responsibleRoles,
      availableActions: available.map(t => ({
        transitionId: t.id,
        name: t.name,
        toStep: {
          id: t.toStepId,
          key: stepsById.get(t.toStepId)?.key,
          name: stepsById.get(t.toStepId)?.name,
        },
        requiresComment: t.requiresComment,
        requiredRoles: (t.allowedRoleIds || []).map(id => ({ id, name: id })),
      })),
      history,
      historyTotal: histTotal,
      referral,
    });
  } catch (e) {
    next(e);
  }
}
