import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '#iam/iamErrors.js';
import { enqueueIdentitySnapshot } from '../identityEvents.js';
import { legacyOrganizationSystem } from '../legacyOrganizationSystem.js';

const IACMS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tenantScopedUser(userId, tenantId) {
  if (!userId || !tenantId) throw new ValidationError('User ID and tenant ID are required');
  return prisma.user.findFirst({ where: { id: userId, tenantId } });
}

export async function updateIdentityInternal(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'];
    const fields = req.body ?? {};
    const allowed = ['firstName', 'lastName', 'phone'];
    if (!Object.keys(fields).some((key) => allowed.includes(key)) || Object.keys(fields).some((key) => !allowed.includes(key))) {
      throw new ValidationError('Only firstName, lastName, and phone can be updated through this endpoint');
    }
    if (fields.firstName !== undefined && (typeof fields.firstName !== 'string' || fields.firstName.length < 1 || fields.firstName.length > 100)) {
      throw new ValidationError('firstName must contain 1 to 100 characters');
    }
    if (fields.lastName !== undefined && (typeof fields.lastName !== 'string' || fields.lastName.length < 1 || fields.lastName.length > 100)) {
      throw new ValidationError('lastName must contain 1 to 100 characters');
    }
    if (fields.phone !== undefined && fields.phone !== null && (typeof fields.phone !== 'string' || fields.phone.length > 30)) {
      throw new ValidationError('phone must be 30 characters or fewer');
    }

    const existing = await tenantScopedUser(id, tenantId);
    if (!existing) throw new NotFoundError('User');
    const user = await prisma.user.update({
      where: { id },
      data: fields,
      select: { id: true, tenantId: true, email: true, firstName: true, lastName: true, phone: true, updatedAt: true },
    });
    await enqueueIdentitySnapshot(user.id);
    return res.json({ user });
  } catch (error) {
    next(error);
  }
}

export async function setIdentityActiveInternal(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'];
    const { isActive } = req.body ?? {};
    if (typeof isActive !== 'boolean') throw new ValidationError('isActive must be a boolean');
    const existing = await tenantScopedUser(id, tenantId);
    if (!existing) throw new NotFoundError('User');
    const user = await prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, tenantId: true, email: true, firstName: true, lastName: true, isActive: true, updatedAt: true },
    });
    await enqueueIdentitySnapshot(user.id);
    return res.json({ user });
  } catch (error) {
    next(error);
  }
}

export async function listIdentitySnapshotInternal(req, res, next) {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit || '250'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 250;
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const rows = await prisma.user.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: {
        id: true,
        tenantId: true,
        email: true,
        username: true,
        phone: true,
        firstName: true,
        lastName: true,
        isActive: true,
        updatedAt: true,
        organizationMemberships: {
          select: {
            status: true,
            organization: { select: { externalSystem: true, externalId: true, isActive: true } },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const users = rows.slice(0, limit).flatMap((user) => {
      const destinations = new Map();
      const legacySystem = legacyOrganizationSystem();
      if (legacySystem && user.tenantId) destinations.set(user.tenantId, user.isActive);
      for (const membership of user.organizationMemberships || []) {
        const organization = membership.organization;
        if (!legacySystem || organization?.externalSystem !== legacySystem) continue;
        if (!IACMS_UUID.test(organization.externalId || '')) continue;
        destinations.set(
          organization.externalId,
          user.isActive && membership.status === 'active' && organization.isActive,
        );
      }
      return [...destinations].map(([tenantId, isActive]) => ({
        subjectId: user.id,
        tenantId,
        email: user.email,
        username: user.username,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive,
        sourceUpdatedAt: user.updatedAt.toISOString(),
      }));
    });
    return res.json({ users, nextCursor: hasMore ? rows[limit - 1].id : null });
  } catch (error) {
    next(error);
  }
}
