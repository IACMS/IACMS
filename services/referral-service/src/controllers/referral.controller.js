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

function tenantHeader(req) {
  const t = req.headers['x-tenant-id'];
  return t ? String(t) : null;
}

/** Accept any canonical 8-4-4-4-12 hex id (seed data uses non–RFC-4122 variant bits). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
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

export async function createReferral(req, res, next) {
  try {
    const { caseId: caseRef, fromTenantId, toTenantId, referralReason, notes, referredBy } = req.body;

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

    const caseId = await resolveCaseId(caseRef, resolvedFrom);

    const out = await prisma.$transaction(async tx => {
      const referral = await tx.caseReferral.create({
        data: {
          caseId,
          fromTenantId: resolvedFrom,
          toTenantId,
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
      assertActorTenant(
        req,
        ref.toTenantId,
        'Only the receiving agency can accept this referral.',
      );

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: { status: 'accepted', acceptedBy: String(accepterId), acceptedAt: new Date() },
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

    await eventBus.publish(TOPICS.REFERRAL_ACCEPTED, {
      referralId: updated.id,
      caseId: updated.caseId,
      fromTenantId: updated.fromTenantId,
      toTenantId: updated.toTenantId,
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

      const referral = await tx.caseReferral.update({
        where: { id: ref.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      await tx.case.update({
        where: { id: ref.caseId },
        data: { currentTenantId: ref.fromTenantId, referralStatus: 'returned' },
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
