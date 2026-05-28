import prisma from '../config/database.js';
import {
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
    const { caseId, fromTenantId, toTenantId, status } = req.query;
    const referrals = await prisma.caseReferral.findMany({
      where: {
        ...(caseId && { caseId }),
        ...(fromTenantId && { fromTenantId }),
        ...(toTenantId && { toTenantId }),
        ...(status && { status }),
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
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}

export async function createReferral(req, res, next) {
  try {
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

export async function acceptReferral(req, res, next) {
  try {
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
