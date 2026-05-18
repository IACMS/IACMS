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
    });
    await eventBus.publish('referral.accepted', {
      referralId: referral.id,
      caseId: referral.caseId,
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
    });
    await eventBus.publish('referral.rejected', {
      referralId: referral.id,
      caseId: referral.caseId,
    });
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}
