import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'referral-service');

async function firstUserEmailForTenant(tenantId) {
  const u = await prisma.user.findFirst({
    where: { tenantId },
    select: { email: true, firstName: true },
  });
  return u;
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
    const partnerContact = await firstUserEmailForTenant(referral.toTenantId);
    await eventBus.publish(TOPICS.REFERRAL_CREATED, {
      referralId: referral.id,
      caseId: referral.caseId,
      caseNumber: referral.case?.caseNumber ?? null,
      caseTitle: referral.case?.title ?? null,
      fromTenantId: referral.fromTenantId,
      toTenantId: referral.toTenantId,
      fromTenantCode: referral.fromTenant?.code ?? null,
      toTenantCode: referral.toTenant?.code ?? null,
      toTenantName: referral.toTenant?.name ?? null,
      referrerEmail: referral.referrer?.email ?? null,
      referrerFirstName: referral.referrer?.firstName ?? null,
      partnerContactEmail: partnerContact?.email ?? null,
      partnerContactFirstName: partnerContact?.firstName ?? null,
      referralReason: referral.referralReason ?? null,
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
        fromTenant: true,
        toTenant: true,
        referrer: true,
        accepter: true,
      },
    });
    await eventBus.publish(TOPICS.REFERRAL_ACCEPTED, {
      referralId: referral.id,
      caseId: referral.caseId,
      caseNumber: referral.case?.caseNumber ?? null,
      caseTitle: referral.case?.title ?? null,
      fromTenantCode: referral.fromTenant?.code ?? null,
      toTenantCode: referral.toTenant?.code ?? null,
      referrerEmail: referral.referrer?.email ?? null,
      referrerFirstName: referral.referrer?.firstName ?? null,
      accepterEmail: referral.accepter?.email ?? null,
      accepterFirstName: referral.accepter?.firstName ?? null,
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
        fromTenant: true,
        toTenant: true,
        referrer: true,
        rejecter: true,
      },
    });
    await eventBus.publish(TOPICS.REFERRAL_REJECTED, {
      referralId: referral.id,
      caseId: referral.caseId,
      caseNumber: referral.case?.caseNumber ?? null,
      caseTitle: referral.case?.title ?? null,
      fromTenantCode: referral.fromTenant?.code ?? null,
      toTenantCode: referral.toTenant?.code ?? null,
      referrerEmail: referral.referrer?.email ?? null,
      referrerFirstName: referral.referrer?.firstName ?? null,
      rejecterEmail: referral.rejecter?.email ?? null,
      rejecterFirstName: referral.rejecter?.firstName ?? null,
    });
    res.json({ referral });
  } catch (error) {
    next(error);
  }
}
