import prisma from '../config/database.js';
import { ValidationError } from '../../../../shared/common/errors.js';
import { userHasTenantWideCaseAccess } from '../security/caseAccessPolicy.js';
import {
  readableCaseConditions,
  incomingReferralReadableCondition,
  mutableCaseConditions,
} from '../utils/tenant-scope.js';

function tenantHeader(req) {
  const t = req.headers['x-tenant-id'];
  if (!t) throw new ValidationError('x-tenant-id header required');
  return String(t);
}

function userHeader(req) {
  const u = req.headers['x-user-id'];
  if (!u) throw new ValidationError('x-user-id header required');
  return String(u);
}

function parseRoleIds(req) {
  const raw = req.headers['x-user-roles'];
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function transitionDurationMs(transition) {
  const amount = transition.timeLimitAmount;
  const unit = transition.timeLimitUnit;
  if (amount == null || amount < 1 || (unit !== 'HOURS' && unit !== 'DAYS')) return null;
  return unit === 'HOURS' ? amount * 3600_000 : amount * 86400_000;
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
  return last?.transitionedAt ?? kase?.createdAt ?? new Date();
}

function timingForTransition(transition, stepEnteredAt) {
  const type = transition.timeLimitType || 'NONE';
  const ms = transitionDurationMs(transition);
  if (!stepEnteredAt || type === 'NONE' || !ms) {
    return { deadlineAt: null, isPastDue: false, timeLimitType: type };
  }
  const deadlineAt = new Date(stepEnteredAt.getTime() + ms);
  return {
    deadlineAt: deadlineAt.toISOString(),
    isPastDue: Date.now() > deadlineAt.getTime(),
    timeLimitType: type,
  };
}

function caseScopeWhere(tenantId, userId, isAdmin) {
  const visibility = readableCaseConditions(tenantId);
  if (isAdmin) {
    return { ...visibility, closedAt: null, status: { not: 'closed' } };
  }
  return {
    ...visibility,
    closedAt: null,
    status: { not: 'closed' },
    AND: [
      {
        OR: [
          { assignedTo: userId },
          { createdBy: userId },
          { tenantId },
          { currentTenantId: tenantId },
          incomingReferralReadableCondition(tenantId),
        ],
      },
      mutableCaseConditions(tenantId),
    ],
  };
}

/**
 * GET /dashboard/tasks — actionable work items for the signed-in user.
 */
export async function getDashboardTasks(req, res, next) {
  try {
    const tenantId = tenantHeader(req);
    const userId = userHeader(req);
    const roleIds = parseRoleIds(req);
    const isAdmin = await userHasTenantWideCaseAccess(prisma, userId);

    const tasks = [];

    const pendingReferrals = await prisma.caseReferral.findMany({
      where: { toTenantId: tenantId, status: 'pending' },
      include: {
        case: { select: { id: true, caseNumber: true, title: true, priority: true } },
        fromTenant: { select: { id: true, code: true, name: true } },
      },
      orderBy: { referredAt: 'desc' },
      take: 25,
    });

    for (const ref of pendingReferrals) {
      tasks.push({
        id: `referral-${ref.id}`,
        type: 'referral_pending',
        priority: ref.case?.priority === 'urgent' || ref.case?.priority === 'high' ? 'high' : 'normal',
        title: `Accept or reject referral`,
        description: ref.referralReason || ref.notes || 'Incoming inter-agency referral',
        caseId: ref.caseId,
        caseNumber: ref.case?.caseNumber ?? null,
        caseTitle: ref.case?.title ?? null,
        referralId: ref.id,
        partnerCode: ref.fromTenant?.code ?? null,
        partnerName: ref.fromTenant?.name ?? null,
        dueAt: null,
        isPastDue: false,
        actionLabel: 'Review referral',
        href: `/cases/${encodeURIComponent(ref.caseId)}`,
      });
    }

    const cases = await prisma.case.findMany({
      where: caseScopeWhere(tenantId, userId, isAdmin),
      include: {
        currentStep: { select: { id: true, name: true, key: true, requiresAttachment: true } },
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 40,
    });

    const caseIds = cases.map((c) => c.id);
    const stepIds = [...new Set(cases.map((c) => c.currentStepId).filter(Boolean))];

    const transitions =
      stepIds.length > 0
        ? await prisma.workflowTransition.findMany({
            where: { fromStepId: { in: stepIds } },
            include: { toStep: { select: { id: true, name: true } } },
          })
        : [];

    const transitionsByStep = new Map();
    for (const t of transitions) {
      if (!transitionsByStep.has(t.fromStepId)) transitionsByStep.set(t.fromStepId, []);
      transitionsByStep.get(t.fromStepId).push(t);
    }

    const attachmentCounts =
      caseIds.length > 0
        ? await prisma.caseAttachment.groupBy({
            by: ['caseId'],
            where: { caseId: { in: caseIds }, deletedAt: null },
            _count: { id: true },
          })
        : [];
    const attByCase = Object.fromEntries(attachmentCounts.map((r) => [r.caseId, r._count.id]));

    for (const c of cases) {
      if (!c.currentStepId) continue;
      const stepEnteredAt = await getStepEnteredAt(c.id, c.currentStepId);
      const outgoing = transitionsByStep.get(c.currentStepId) ?? [];

      const needsAttachment =
        Boolean(c.currentStep?.requiresAttachment) && (attByCase[c.id] ?? 0) < 1;

      if (needsAttachment) {
        tasks.push({
          id: `attachment-${c.id}`,
          type: 'attachment_required',
          priority: 'high',
          title: 'Upload required document',
          description: `Case is on step “${c.currentStep?.name ?? 'current'}” and needs an attachment before proceeding.`,
          caseId: c.id,
          caseNumber: c.caseNumber,
          caseTitle: c.title,
          referralId: null,
          partnerCode: null,
          partnerName: null,
          dueAt: null,
          isPastDue: false,
          actionLabel: 'Open case',
          href: `/cases/${encodeURIComponent(c.id)}`,
        });
      }

      for (const tr of outgoing) {
        if (tr.allowedRoleIds?.length) {
          const ok = tr.allowedRoleIds.some((r) => roleIds.includes(r));
          if (!ok) continue;
        }
        const timing = timingForTransition(tr, stepEnteredAt);
        const blocked = timing.timeLimitType === 'DEADLINE' && timing.isPastDue;
        tasks.push({
          id: `transition-${c.id}-${tr.id}`,
          type: blocked ? 'transition_overdue' : 'transition',
          priority: timing.isPastDue ? 'urgent' : c.priority === 'urgent' ? 'high' : 'normal',
          title: tr.name,
          description: `Move case to “${tr.toStep?.name ?? 'next step'}”`,
          caseId: c.id,
          caseNumber: c.caseNumber,
          caseTitle: c.title,
          referralId: null,
          partnerCode: null,
          partnerName: null,
          transitionId: tr.id,
          dueAt: timing.deadlineAt,
          isPastDue: timing.isPastDue,
          blocked,
          actionLabel: blocked ? 'Blocked (deadline)' : 'Open case',
          href: `/cases/${encodeURIComponent(c.id)}`,
        });
      }
    }

    const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
    tasks.sort((a, b) => {
      const pa = priorityRank[a.priority] ?? 9;
      const pb = priorityRank[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      if (a.isPastDue !== b.isPastDue) return a.isPastDue ? -1 : 1;
      return 0;
    });

    res.json({
      tasks,
      summary: {
        total: tasks.length,
        referrals: pendingReferrals.length,
        transitions: tasks.filter((t) => t.type === 'transition' || t.type === 'transition_overdue').length,
        attachments: tasks.filter((t) => t.type === 'attachment_required').length,
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /dashboard/reports — tenant operational summary for the Reports page.
 */
export async function getDashboardReports(req, res, next) {
  try {
    const tenantId = tenantHeader(req);

    const caseWhere = readableCaseConditions(tenantId);

    const [cases, referrals, workflows, recentHistory] = await Promise.all([
      prisma.case.findMany({
        where: caseWhere,
        select: {
          id: true,
          status: true,
          priority: true,
          referralStatus: true,
          closedAt: true,
          tenantId: true,
          currentTenantId: true,
          createdAt: true,
        },
      }),
      prisma.caseReferral.findMany({
        where: { OR: [{ fromTenantId: tenantId }, { toTenantId: tenantId }] },
        select: {
          id: true,
          status: true,
          fromTenantId: true,
          toTenantId: true,
          referredAt: true,
          fromTenant: { select: { code: true, name: true } },
          toTenant: { select: { code: true, name: true } },
        },
      }),
      prisma.workflow.findMany({
        where: { tenantId },
        select: { id: true, status: true, key: true, name: true },
      }),
      prisma.caseHistory.findMany({
        where: { tenantId },
        orderBy: { transitionedAt: 'desc' },
        take: 30,
        include: {
          transition: { select: { name: true } },
          actor: { select: { firstName: true, lastName: true, email: true } },
          case: { select: { caseNumber: true, title: true } },
        },
      }),
    ]);

    const openCases = cases.filter((c) => !c.closedAt && c.status !== 'closed');
    const closedCases = cases.filter((c) => c.closedAt || c.status === 'closed');

    const byPriority = {};
    const byStatus = {};
    for (const c of cases) {
      const p = (c.priority || 'normal').toLowerCase();
      byPriority[p] = (byPriority[p] || 0) + 1;
      const s = (c.status || 'open').toLowerCase();
      byStatus[s] = (byStatus[s] || 0) + 1;
    }

    const referralByStatus = {};
    for (const r of referrals) {
      const st = (r.status || 'pending').toLowerCase();
      referralByStatus[st] = (referralByStatus[st] || 0) + 1;
    }

    const partnerMap = new Map();
    for (const r of referrals) {
      const partner =
        r.fromTenantId === tenantId
          ? r.toTenant
          : r.fromTenant;
      const key = partner?.code ?? (r.fromTenantId === tenantId ? r.toTenantId : r.fromTenantId);
      if (!partnerMap.has(key)) {
        partnerMap.set(key, {
          code: partner?.code ?? '—',
          name: partner?.name ?? 'Partner agency',
          incoming: 0,
          outgoing: 0,
          pending: 0,
        });
      }
      const row = partnerMap.get(key);
      if (r.toTenantId === tenantId) row.incoming += 1;
      if (r.fromTenantId === tenantId) row.outgoing += 1;
      if (r.status === 'pending' && r.toTenantId === tenantId) row.pending += 1;
    }

    const workflowByStatus = {};
    for (const w of workflows) {
      const st = (w.status || 'DRAFT').toUpperCase();
      workflowByStatus[st] = (workflowByStatus[st] || 0) + 1;
    }

    const last30 = new Date(Date.now() - 30 * 86400_000);
    const transitionsLast30 = recentHistory.filter(
      (h) => h.transitionedAt && new Date(h.transitionedAt) >= last30,
    ).length;

    res.json({
      generatedAt: new Date().toISOString(),
      cases: {
        total: cases.length,
        open: openCases.length,
        closed: closedCases.length,
        byPriority,
        byStatus,
        inCustody: cases.filter((c) => (c.currentTenantId ?? c.tenantId) === tenantId).length,
      },
      referrals: {
        total: referrals.length,
        byStatus: referralByStatus,
        incoming: referrals.filter((r) => r.toTenantId === tenantId).length,
        outgoing: referrals.filter((r) => r.fromTenantId === tenantId).length,
        pendingIncoming: referrals.filter((r) => r.toTenantId === tenantId && r.status === 'pending').length,
      },
      workflows: {
        total: workflows.length,
        byStatus: workflowByStatus,
      },
      activity: {
        transitionsLast30Days: transitionsLast30,
        recent: recentHistory.slice(0, 15).map((h) => ({
          id: h.id,
          caseId: h.caseId,
          caseNumber: h.case?.caseNumber ?? null,
          caseTitle: h.case?.title ?? null,
          transitionName: h.transition?.name ?? null,
          actorLabel: h.actor
            ? `${h.actor.firstName ?? ''} ${h.actor.lastName ?? ''}`.trim() || h.actor.email
            : null,
          transitionedAt: h.transitionedAt?.toISOString?.() ?? h.transitionedAt,
        })),
      },
      partners: [...partnerMap.values()].sort((a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing)),
    });
  } catch (e) {
    next(e);
  }
}
