import prisma from '../config/database.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  InvalidReferralStateError,
} from '../../../../shared/common/errors.js';

function assertActorTenant(req, expectedTenantId, message) {
  const actor = tenantHeader(req);
  if (!actor || actor !== String(expectedTenantId)) {
    throw new ForbiddenError(message);
  }
}
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'referral-service');

function tenantId(req) {
  return String(req.headers['x-tenant-id']);
}

function userId(req) {
  return String(req.headers['x-user-id']);
}

function departmentHeader(req) {
  const d = req.headers['x-department-id'];
  return d ? String(d) : null;
}

function tenantHeader(req) {
  const t = req.headers['x-tenant-id'];
  return t ? String(t) : null;
}

/** Accept any canonical 8-4-4-4-12 hex id (seed data uses non–RFC-4122 variant bits). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function parseMetadata(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function mergeMetadata(existing, patch) {
  return { ...parseMetadata(existing), ...patch };
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

async function getPublishedWorkflowByKey(tx, tenantId, key) {
  return tx.workflow.findFirst({
    where: { tenantId, key, status: 'PUBLISHED' },
    include: {
      steps: {
        orderBy: [{ position: 'asc' }, { key: 'asc' }],
      },
    },
    orderBy: { version: 'desc' },
  });
}

function getInitialStep(workflow) {
  return workflow?.steps?.find((step) => step.isInitial) ?? null;
}

async function deactivateActiveAssignments(tx, caseId) {
  await tx.assignment.updateMany({
    where: { caseId, isActive: true },
    data: { isActive: false, unassignedAt: new Date() },
  });
}

function buildReferralProgress(referral) {
  const metadata = parseMetadata(referral.metadata);
  const caseRow = referral.case ?? {};
  const referralStatus = String(referral.status || '').toLowerCase();
  const caseReferralStatus = String(caseRow.referralStatus || '').toLowerCase();
  const caseStatus = String(caseRow.status || '').toLowerCase();
  const hasReceiverAssignment = Boolean(
    metadata.receivingAssignedWorkflowId || caseRow.assignedTo,
  );
  const movedBeyondAssignedInitialStep = Boolean(
    metadata.receivingAssignedInitialStepId &&
      caseRow.currentStepId &&
      String(metadata.receivingAssignedInitialStepId) !== String(caseRow.currentStepId),
  );

  let range = 'Received';
  if (referralStatus === 'rejected') {
    range = 'Rejected';
  } else if (referralStatus === 'completed') {
    range = 'Completed';
  } else if (caseReferralStatus === 'awaiting_assignment' || referralStatus === 'pending') {
    range = 'Received';
  } else if (caseStatus.includes('resolved') || caseStatus.includes('closed')) {
    range = 'Near completion';
  } else if (caseReferralStatus === 'in_progress' && hasReceiverAssignment) {
    range = movedBeyondAssignedInitialStep ? 'Being worked on' : 'Assigned';
  } else if (hasReceiverAssignment) {
    range = 'Assigned';
  }

  return {
    range,
    lastUpdatedAt:
      isoOrNull(caseRow.updatedAt) ||
      isoOrNull(referral.completedAt) ||
      isoOrNull(referral.rejectedAt) ||
      isoOrNull(referral.acceptedAt) ||
      isoOrNull(referral.referredAt),
  };
}

function withProgress(referral, actorTenantId) {
  if (!referral || referral.fromTenantId !== actorTenantId) return referral;
  return { ...referral, progress: buildReferralProgress(referral) };
}

/** Accept case UUID or tenant-scoped case number (e.g. DCS01-2026-0001). */
async function resolveCaseId(caseRef, fromTenantId) {
  const raw = String(caseRef || '').trim();
  if (!raw) throw new ValidationError('caseId is required');
  if (isUuid(raw)) return raw;

  const kase = await prisma.case.findFirst({
    where: {
      caseNumber: raw,
      deletedAt: null,
      OR: [
        { tenantId: fromTenantId },
        { originatingTenantId: fromTenantId },
        { currentTenantId: fromTenantId },
      ],
    },
    select: { id: true },
  });
  if (!kase) {
    throw new ValidationError(
      'Case not found. Use the case UUID from the case page URL, or the full case number (e.g. DCS01-2026-0001).',
    );
  }
  return kase.id;
}

/**
 * List referrals visible to this tenant (as sender or receiver).
 * Query filters are scoped to rows involving actorTenantId.
 */
export async function getReferrals(req, res, next) {
  try {
    const actorTenantId = tenantId(req);
    const { caseId, status } = req.query;

    const referrals = await prisma.caseReferral.findMany({
      where: {
        AND: [
          { OR: [{ fromTenantId: actorTenantId }, { toTenantId: actorTenantId }] },
          ...(caseId ? [{ caseId: String(caseId) }] : []),
          ...(status ? [{ status: String(status) }] : []),
        ],
      },
      include: {
        case: true,
        fromTenant: true,
        toTenant: true,
        referrer: true,
        accepter: true,
        rejecter: true,
      },
      orderBy: { referredAt: 'desc' },
    });
    res.json({ referrals: referrals.map((referral) => withProgress(referral, actorTenantId)) });
  } catch (error) {
    next(error);
  }
}

export async function getReferral(req, res, next) {
  try {
    const actorTenantId = tenantId(req);
    const referral = await prisma.caseReferral.findUnique({
      where: { id: req.params.id },
      include: {
        case: true,
        fromTenant: true,
        toTenant: true,
        referrer: true,
        accepter: true,
        rejecter: true,
      },
    });
    if (!referral) throw new NotFoundError('Referral');
    if (referral.fromTenantId !== actorTenantId && referral.toTenantId !== actorTenantId) {
      throw new NotFoundError('Referral');
    }
    res.json({ referral: withProgress(referral, actorTenantId) });
  } catch (error) {
    next(error);
  }
}

export async function createReferral(req, res, next) {
  try {
    const {
      caseId: caseRef,
      fromTenantId,
      toTenantId,
      fromDepartmentId,
      toDepartmentId,
      referralReason,
      notes,
      referredBy,
    } = req.body;

    const callerTenant = tenantHeader(req) || fromTenantId;
    if (!callerTenant) throw new ValidationError('x-tenant-id or fromTenantId required');
    if (!toTenantId || !isUuid(String(toTenantId))) {
      throw new ValidationError(
        'Partner organization is invalid. Validate the tenant code first, then submit again.',
      );
    }
    const refBy = referredBy || req.headers['x-user-id'];
    if (!refBy || !isUuid(String(refBy))) {
      throw new ValidationError('referredBy must be a valid user UUID.');
    }

    const resolvedFrom = fromTenantId || callerTenant;
    if (!isUuid(String(resolvedFrom))) {
      throw new ValidationError('fromTenantId must be a valid tenant UUID.');
    }

    const resolvedFromDept = fromDepartmentId || departmentHeader(req);
    if (!resolvedFromDept || !isUuid(String(resolvedFromDept))) {
      throw new ValidationError('fromDepartmentId is required (or provide x-department-id header).');
    }
    if (!toDepartmentId || !isUuid(String(toDepartmentId))) {
      throw new ValidationError('toDepartmentId is required and must be a valid department UUID.');
    }

    const caseId = await resolveCaseId(caseRef, resolvedFrom);

    const out = await prisma.$transaction(async tx => {
      const kase = await tx.case.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          currentTenantId: true,
          currentDepartmentId: true,
          tenantId: true,
        },
      });
      if (!kase) throw new NotFoundError('Case');
      if (String(kase.currentTenantId || kase.tenantId) !== String(resolvedFrom)) {
        throw new ForbiddenError('You can only refer cases currently held by your agency.');
      }
      if (kase.currentDepartmentId && String(kase.currentDepartmentId) !== String(resolvedFromDept)) {
        throw new ForbiddenError('You can only refer cases currently held by your department.');
      }

      const referral = await tx.caseReferral.create({
        data: {
          caseId,
          fromTenantId: resolvedFrom,
          toTenantId,
          fromDepartmentId: String(resolvedFromDept),
          toDepartmentId: String(toDepartmentId),
          referralReason,
          notes,
          status: 'pending',
          referredBy: String(refBy),
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { referralStatus: 'pending_referral' },
      });
      return referral;
    });

    const payload = {
      referralId: out.id,
      caseId,
      originatingTenantId: out.fromTenantId,
      currentTenantId: out.toTenantId,
      fromTenantId: out.fromTenantId,
      toTenantId: out.toTenantId,
      fromDepartmentId: out.fromDepartmentId,
      toDepartmentId: out.toDepartmentId,
      status: 'pending',
      referredBy: String(refBy),
      referredAt: out.referredAt.toISOString(),
    };
    await eventBus.publish(TOPICS.REFERRAL_CREATED, payload);
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: out.fromTenantId,
      relatedTenantId: out.toTenantId,
      entityType: 'referral',
      entityId: out.id,
      action: 'referral.create',
      userId: String(refBy),
      oldValues: null,
      newValues: { caseId, toTenantId: out.toTenantId, status: 'pending' },
      metadata: { referredAt: out.referredAt.toISOString() },
    });

    const referral = await prisma.caseReferral.findUnique({
      where: { id: out.id },
      include: { case: true, fromTenant: true, toTenant: true, referrer: true },
    });
    res.status(201).json({ referral });
  } catch (error) {
    next(error);
  }
}

export async function acceptReferral(req, res, next) {
  try {
    const { acceptedBy } = req.body;
    const accepterId = acceptedBy || req.headers['x-user-id'];
    if (!accepterId) throw new ValidationError('acceptedBy is required');
    const receiverDept = departmentHeader(req);

    const updated = await prisma.$transaction(async tx => {
      const ref = await tx.caseReferral.findUnique({
        where: { id: req.params.id },
        include: { case: true },
      });
      if (!ref) throw new NotFoundError('Referral');
      if (ref.status !== 'pending') throw new InvalidReferralStateError('Referral must be pending');
      assertActorTenant(
        req,
        ref.toTenantId,
        'Only the receiving agency can accept this referral.',
      );
      if (!ref.toDepartmentId) {
        throw new ValidationError('Referral is missing toDepartmentId and cannot be accepted.');
      }
      if (receiverDept && String(receiverDept) !== String(ref.toDepartmentId)) {
        throw new ForbiddenError('You can only accept referrals addressed to your department.');
      }

      const placeholderWorkflow = await getPublishedWorkflowByKey(tx, ref.toTenantId, 'referral-intake');
      if (!placeholderWorkflow) {
        throw new ValidationError(
          'Receiving agency is missing the referral-intake workflow. Reseed or create it before accepting referrals.',
        );
      }
      const placeholderInitialStep = getInitialStep(placeholderWorkflow);
      if (!placeholderInitialStep) {
        throw new ValidationError('referral-intake workflow must have an initial step.');
      }

      const metadata = mergeMetadata(ref.metadata, {
        originWorkflowId: ref.case.workflowId,
        originWorkflowVersion: ref.case.workflowVersion,
        originCurrentStepId: ref.case.currentStepId,
        originAssignedTo: ref.case.assignedTo,
        originDepartmentId: ref.case.currentDepartmentId ?? ref.case.originatingDepartmentId ?? null,
        placeholderWorkflowId: placeholderWorkflow.id,
        placeholderWorkflowVersion: placeholderWorkflow.version,
        placeholderCurrentStepId: placeholderInitialStep.id,
      });

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: {
          status: 'accepted',
          acceptedBy: String(accepterId),
          acceptedAt: new Date(),
          metadata,
        },
      });
      await deactivateActiveAssignments(tx, ref.caseId);
      await tx.case.update({
        where: { id: ref.caseId },
        data: {
          currentTenantId: ref.toTenantId,
          originatingTenantId: ref.case.originatingTenantId ?? ref.fromTenantId,
          currentDepartmentId: ref.toDepartmentId,
          originatingDepartmentId:
            ref.case.originatingDepartmentId ?? ref.case.currentDepartmentId ?? ref.fromDepartmentId ?? null,
          referralStatus: 'awaiting_assignment',
          workflowId: placeholderWorkflow.id,
          workflowVersion: placeholderWorkflow.version,
          currentStepId: placeholderInitialStep.id,
          assignedTo: null,
        },
      });
      return referral;
    });

    await eventBus.publish(TOPICS.REFERRAL_ACCEPTED, {
      referralId: updated.id,
      caseId: updated.caseId,
      fromTenantId: updated.fromTenantId,
      toTenantId: updated.toTenantId,
      fromDepartmentId: updated.fromDepartmentId,
      toDepartmentId: updated.toDepartmentId,
      acceptedBy: String(accepterId),
      acceptedAt: updated.acceptedAt.toISOString(),
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: updated.fromTenantId,
      relatedTenantId: updated.toTenantId,
      entityType: 'referral',
      entityId: updated.id,
      action: 'referral.accept',
      userId: String(accepterId),
      oldValues: { status: 'pending' },
      newValues: {
        status: 'accepted',
        caseCurrentTenantId: updated.toTenantId,
        caseReferralStatus: 'awaiting_assignment',
      },
      metadata: { acceptedAt: updated.acceptedAt.toISOString() },
    });

    const referral = await prisma.caseReferral.findUnique({
      where: { id: updated.id },
      include: { case: true, accepter: true },
    });
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}

export async function assignReferral(req, res, next) {
  try {
    const { workflowId, assignedToUserId } = req.body || {};
    const actorTenant = tenantHeader(req);
    const actorId = userId(req);
    const actorDept = departmentHeader(req);
    if (!actorTenant) throw new ValidationError('x-tenant-id header required');
    if (!actorId) throw new ValidationError('x-user-id header required');
    if (!workflowId || !isUuid(String(workflowId))) throw new ValidationError('workflowId is required');
    if (!assignedToUserId || !isUuid(String(assignedToUserId))) {
      throw new ValidationError('assignedToUserId is required');
    }

    const updated = await prisma.$transaction(async tx => {
      const ref = await tx.caseReferral.findUnique({
        where: { id: req.params.id },
        include: { case: true },
      });
      if (!ref) throw new NotFoundError('Referral');
      if (ref.status !== 'accepted') {
        throw new InvalidReferralStateError('Referral must be accepted before assignment.');
      }
      assertActorTenant(req, ref.toTenantId, 'Only the receiving agency can assign this referral.');
      if (actorDept && ref.toDepartmentId && String(actorDept) !== String(ref.toDepartmentId)) {
        throw new ForbiddenError('You can only assign referrals for your own department.');
      }

      const workflow = await tx.workflow.findFirst({
        where: { id: String(workflowId), tenantId: ref.toTenantId, status: 'PUBLISHED' },
        include: { steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] } },
      });
      if (!workflow) throw new NotFoundError('Workflow');
      const initialStep = getInitialStep(workflow);
      if (!initialStep) throw new ValidationError('Selected workflow must have an initial step.');

      const assignee = await tx.user.findFirst({
        where: { id: String(assignedToUserId), tenantId: ref.toTenantId, isActive: true },
        select: { id: true },
      });
      if (!assignee) throw new ValidationError('Assigned user must be active and belong to the receiving agency.');

      const metadata = mergeMetadata(ref.metadata, {
        receivingAssignedWorkflowId: workflow.id,
        receivingAssignedWorkflowVersion: workflow.version,
        receivingAssignedAt: new Date().toISOString(),
        receivingAssignedInitialStepId: initialStep.id,
        receivingAssignedDepartmentId: ref.toDepartmentId ?? actorDept ?? null,
      });

      await deactivateActiveAssignments(tx, ref.caseId);
      await tx.assignment.create({
        data: {
          caseId: ref.caseId,
          assignedTo: assignee.id,
          assignedBy: actorId,
          assignmentType: 'referral_assignment',
          notes: 'Assigned by receiving agency after accepting referral.',
          isActive: true,
        },
      });

      await tx.case.update({
        where: { id: ref.caseId },
        data: {
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          currentStepId: initialStep.id,
          assignedTo: assignee.id,
          referralStatus: 'in_progress',
          currentDepartmentId: ref.toDepartmentId ?? actorDept ?? null,
        },
      });

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: { metadata },
      });

      return referral;
    });

    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: updated.toTenantId,
      relatedTenantId: updated.fromTenantId,
      entityType: 'referral',
      entityId: updated.id,
      action: 'referral.assign',
      userId: String(actorId),
      oldValues: { caseReferralStatus: 'awaiting_assignment' },
      newValues: {
        caseReferralStatus: 'in_progress',
        workflowId: String(workflowId),
        assignedToUserId: String(assignedToUserId),
      },
    });

    const referral = await prisma.caseReferral.findUnique({
      where: { id: updated.id },
      include: { case: true, fromTenant: true, toTenant: true, accepter: true },
    });
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}

export async function rejectReferral(req, res, next) {
  try {
    const { rejectedBy } = req.body;
    const rejId = rejectedBy || req.headers['x-user-id'];
    if (!rejId) throw new ValidationError('rejectedBy is required');

    const updated = await prisma.$transaction(async tx => {
      const ref = await tx.caseReferral.findUnique({
        where: { id: req.params.id },
        include: { case: true },
      });
      if (!ref) throw new NotFoundError('Referral');
      if (ref.status !== 'pending') throw new InvalidReferralStateError();
      const actor = tenantHeader(req);
      if (actor !== ref.toTenantId && actor !== ref.fromTenantId) {
        throw new ForbiddenError('Only the sending or receiving agency can reject this referral.');
      }

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: { status: 'rejected', rejectedBy: String(rejId), rejectedAt: new Date() },
      });
      await tx.case.update({
        where: { id: ref.caseId },
        data: { referralStatus: 'rejected' },
      });
      return referral;
    });

    await eventBus.publish(TOPICS.REFERRAL_REJECTED, {
      referralId: updated.id,
      caseId: updated.caseId,
      originatingTenantId: updated.fromTenantId,
      currentTenantId: updated.fromTenantId,
      rejectedBy: String(rejId),
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: updated.fromTenantId,
      relatedTenantId: updated.toTenantId,
      entityType: 'referral',
      entityId: updated.id,
      action: 'referral.reject',
      userId: String(rejId),
      oldValues: { status: 'pending' },
      newValues: { status: 'rejected', caseReferralStatus: 'rejected' },
    });

    const referral = await prisma.caseReferral.findUnique({
      where: { id: updated.id },
      include: { case: true, rejecter: true },
    });
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}

export async function completeReferral(req, res, next) {
  try {
    const actorId = req.body.completedBy || req.headers['x-user-id'];
    if (!actorId) throw new ValidationError('completedBy is required');

    const updated = await prisma.$transaction(async tx => {
      const ref = await tx.caseReferral.findUnique({
        where: { id: req.params.id },
        include: { case: true },
      });
      if (!ref) throw new NotFoundError('Referral');
      if (ref.status !== 'accepted') throw new InvalidReferralStateError('Referral must be accepted');
      const actor = tenantHeader(req);
      if (actor !== ref.toTenantId && actor !== ref.fromTenantId) {
        throw new ForbiddenError('Only agencies involved in this referral can mark it completed.');
      }

      const metadata = parseMetadata(ref.metadata);
      if (!metadata.originWorkflowId) {
        throw new ValidationError('Referral is missing original workflow information and cannot be returned safely.');
      }
      const originDepartmentId = metadata.originDepartmentId ? String(metadata.originDepartmentId) : null;

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      await deactivateActiveAssignments(tx, ref.caseId);
      if (metadata.originAssignedTo) {
        await tx.assignment.create({
          data: {
            caseId: ref.caseId,
            assignedTo: String(metadata.originAssignedTo),
            assignedBy: String(actorId),
            assignmentType: 'referral_return',
            notes: 'Original assignment restored when referral returned to sender.',
            isActive: true,
          },
        });
      }
      await tx.case.update({
        where: { id: ref.caseId },
        data: {
          currentTenantId: ref.fromTenantId,
          referralStatus: 'returned',
          workflowId: String(metadata.originWorkflowId),
          workflowVersion: Number(metadata.originWorkflowVersion || 1),
          currentStepId: metadata.originCurrentStepId ? String(metadata.originCurrentStepId) : null,
          assignedTo: metadata.originAssignedTo ? String(metadata.originAssignedTo) : null,
          currentDepartmentId: originDepartmentId,
        },
      });
      return referral;
    });

    await eventBus.publish(TOPICS.REFERRAL_COMPLETED, {
      referralId: updated.id,
      caseId: updated.caseId,
      originatingTenantId: updated.fromTenantId,
      currentTenantId: updated.fromTenantId,
    });
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: updated.toTenantId,
      relatedTenantId: updated.fromTenantId,
      entityType: 'referral',
      entityId: updated.id,
      action: 'referral.complete',
      userId: String(actorId),
      oldValues: { status: 'accepted' },
      newValues: { status: 'completed', caseReturnedToTenantId: updated.fromTenantId },
    });

    const referral = await prisma.caseReferral.findUnique({
      where: { id: updated.id },
      include: { case: true },
    });
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}
