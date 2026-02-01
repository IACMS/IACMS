import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../shared/common/errors.js';
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');

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
      orderBy: {
        referredAt: 'desc',
      },
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
    const referral = await prisma.caseReferral.create({
      data: req.body,
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

export async function acceptReferral(req, res, next) {
  try {
    const { acceptedBy } = req.body;
    if (!acceptedBy) {
      throw new ValidationError('acceptedBy is required');
    }
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
    const { rejectedBy } = req.body;
    if (!rejectedBy) {
      throw new ValidationError('rejectedBy is required');
    }
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

