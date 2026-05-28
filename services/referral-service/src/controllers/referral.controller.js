import prisma from '../config/database.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  InvalidReferralStateError,
} from '../../../../shared/common/errors.js';
import EventBus from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'referral-service');

function tenantId(req) {
  return String(req.headers['x-tenant-id']);
}

function userId(req) {
  return String(req.headers['x-user-id']);
}

/**
 * List referrals visible to this tenant (as sender or receiver).
 * Query filters are scoped to rows involving actorTenantId.
 */
  NotFoundError,
  ValidationError,
  InvalidReferralStateError,
} from '../../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'referral-service');

function tenantHeader(req) {
  const t = req.headers['x-tenant-id'];
  return t ? String(t) : null;
}

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
    res.json({ referrals });
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
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}

/**
 * Outbound referral: case must belong to the caller's tenant (from-tenant).
 */
export async function createReferral(req, res, next) {
  try {
    const fromTenantId = tenantId(req);
    const referredBy = userId(req);
    const body = req.body || {};
    const { caseId, toTenantId, referralReason, notes, metadata } = body;

    if (!caseId || !toTenantId) {
      throw new ValidationError('caseId and toTenantId are required');
    }
    if (String(toTenantId) === fromTenantId) {
      throw new ValidationError('toTenantId must differ from your tenant');
    }

    const caseRow = await prisma.case.findFirst({
      where: { id: String(caseId), tenantId: fromTenantId, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!caseRow) throw new NotFoundError('Case');

    const targetTenant = await prisma.tenant.findUnique({
      where: { id: String(toTenantId) },
      select: { id: true, isActive: true },
    });
    if (!targetTenant) throw new NotFoundError('Target tenant');
    if (!targetTenant.isActive) {
      throw new ValidationError('Target tenant is not active');
    }

    const actor = await prisma.user.findFirst({
      where: { id: referredBy, tenantId: fromTenantId, isActive: true },
      select: { id: true },
    });
    if (!actor) throw new ForbiddenError('User not recognized in this tenant');

    const referral = await prisma.caseReferral.create({
      data: {
        caseId: String(caseId),
        fromTenantId,
        toTenantId: String(toTenantId),
        referralReason: referralReason ?? undefined,
        notes: notes ?? undefined,
        referredBy,
        metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
      },
      include: {
        case: true,
        fromTenant: true,
        toTenant: true,
        referrer: true,
      },
    });

    await eventBus.publish('referral.created', {
      referralId: referral.id,
      caseId: referral.caseId,
      fromTenantId: referral.fromTenantId,
      toTenantId: referral.toTenantId,
    const {
      caseId, fromTenantId, toTenantId, referralReason, notes,
      referredBy,
    } = req.body;

    const callerTenant = tenantHeader(req) || fromTenantId;
    if (!callerTenant) throw new ValidationError('x-tenant-id or fromTenantId required');
    const refBy = referredBy || req.headers['x-user-id'];
    if (!refBy) throw new ValidationError('referredBy or x-user-id required');

    const out = await prisma.$transaction(async tx => {
      const referral = await tx.caseReferral.create({
        data: {
          caseId,
          fromTenantId: fromTenantId || callerTenant,
          toTenantId,
          referralReason,
          notes,
          status: 'pending',
          referredBy: String(refBy),
        },
      });

      await tx.case.update({
        where: { id: caseId },
        data: {
          referralStatus: 'pending_referral',
        },
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

/** Only receiving tenant may accept pending referral. Actor is gateway user ID. */
export async function acceptReferral(req, res, next) {
  try {
    const actorTenantId = tenantId(req);
    const acceptedBy = userId(req);

    const existing = await prisma.caseReferral.findUnique({
      where: { id: req.params.id },
      include: { case: true },
    });
    if (!existing) throw new NotFoundError('Referral');
    if (existing.toTenantId !== actorTenantId) {
      throw new ForbiddenError('Only the receiving tenant can accept this referral');
    }
    if (existing.status !== 'pending') {
      throw new InvalidReferralStateError('Referral is not pending acceptance');
    }

    const acceptingUser = await prisma.user.findFirst({
      where: { id: acceptedBy, tenantId: actorTenantId, isActive: true },
      select: { id: true },
    });
    if (!acceptingUser) throw new ForbiddenError('User not recognized in this tenant');

    const referral = await prisma.caseReferral.update({
      where: { id: req.params.id },
      data: {
        status: 'accepted',
        acceptedBy,
        acceptedAt: new Date(),
      },
      include: {
        case: true,
        accepter: true,
      },
    const { acceptedBy } = req.body;
    const accepterId = acceptedBy || req.headers['x-user-id'];
    if (!accepterId) throw new ValidationError('acceptedBy is required');

    const updated = await prisma.$transaction(async tx => {
      const ref = await tx.caseReferral.findUnique({
        where: { id: req.params.id },
        include: { case: true },
      });
      if (!ref) throw new NotFoundError('Referral');
      if (ref.status !== 'pending') throw new InvalidReferralStateError('Referral must be pending');

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: {
          status: 'accepted',
          acceptedBy: String(accepterId),
          acceptedAt: new Date(),
        },
      });

      await tx.case.update({
        where: { id: ref.caseId },
        data: {
          currentTenantId: ref.toTenantId,
          originatingTenantId: ref.case.originatingTenantId ?? ref.fromTenantId,
          referralStatus: 'in_progress',
        },
      });

      return referral;
    });

    const payload = {
      referralId: updated.id,
      caseId: updated.caseId,
      originatingTenantId: updated.fromTenantId,
      currentTenantId: updated.toTenantId,
      fromTenantId: updated.fromTenantId,
      toTenantId: updated.toTenantId,
      acceptedBy: String(accepterId),
      acceptedAt: updated.acceptedAt.toISOString(),
    };
    await eventBus.publish(TOPICS.REFERRAL_ACCEPTED, payload);
    await eventBus.publish(TOPICS.AUDIT_LOG, {
      tenantId: updated.fromTenantId,
      relatedTenantId: updated.toTenantId,
      entityType: 'referral',
      entityId: updated.id,
      action: 'referral.accept',
      userId: String(accepterId),
      oldValues: { status: 'pending' },
      newValues: { status: 'accepted', caseCurrentTenantId: updated.toTenantId },
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

export async function rejectReferral(req, res, next) {
  try {
    const actorTenantId = tenantId(req);
    const rejectedBy = userId(req);

    const existing = await prisma.caseReferral.findUnique({
      where: { id: req.params.id },
      include: { case: true },
    });
    if (!existing) throw new NotFoundError('Referral');
    if (existing.toTenantId !== actorTenantId) {
      throw new ForbiddenError('Only the receiving tenant can reject this referral');
    }
    if (existing.status !== 'pending') {
      throw new InvalidReferralStateError('Referral is not pending');
    }

    const rejectingUser = await prisma.user.findFirst({
      where: { id: rejectedBy, tenantId: actorTenantId, isActive: true },
      select: { id: true },
    });
    if (!rejectingUser) throw new ForbiddenError('User not recognized in this tenant');

    const referral = await prisma.caseReferral.update({
      where: { id: req.params.id },
      data: {
        status: 'rejected',
        rejectedBy,
        rejectedAt: new Date(),
      },
      include: {
        case: true,
        rejecter: true,
      },
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

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: {
          status: 'rejected',
          rejectedBy: String(rejId),
          rejectedAt: new Date(),
        },
      });

      await tx.case.update({
        where: { id: ref.caseId },
        data: { referralStatus: 'rejected' },
      });

      return referral;
    });

    const payload = {
      referralId: updated.id,
      caseId: updated.caseId,
      originatingTenantId: updated.fromTenantId,
      currentTenantId: updated.fromTenantId,
      rejectedBy: String(rejId),
    };
    await eventBus.publish(TOPICS.REFERRAL_REJECTED, payload);
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

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });

      await tx.case.update({
        where: { id: ref.caseId },
        data: {
          currentTenantId: ref.fromTenantId,
          referralStatus: 'returned',
        },
      });

      return referral;
    });

    const payload = {
      referralId: updated.id,
      caseId: updated.caseId,
      originatingTenantId: updated.fromTenantId,
      currentTenantId: updated.fromTenantId,
    };
    await eventBus.publish(TOPICS.REFERRAL_COMPLETED, payload);
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
