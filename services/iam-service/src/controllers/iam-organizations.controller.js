import prisma from '../config/database.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '#iam/iamErrors.js';
import { enqueueIdentitySnapshot } from '../identityEvents.js';
import { isPlatformAdminRequest } from '../utils/internalToken.js';

const membershipStatuses = new Set(['active', 'inactive', 'pending', 'suspended']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function assertPlatformAdmin(req) {
  if (isPlatformAdminRequest(req)) return;

  const roleIds = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : [];
  if (roleIds.length) {
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds }, isActive: true },
      select: { name: true },
    });
    if (roles.some(({ name }) => name === 'system_admin')) return;
  }
  throw new ForbiddenError('Only platform administrators may manage IAM organizations');
}

export async function listIamOrganizations(req, res, next) {
  try {
    await assertPlatformAdmin(req);
    const organizations = await prisma.iamOrganization.findMany({
      select: {
        id: true, name: true, slug: true, externalSystem: true, externalId: true,
        isActive: true, metadata: true, createdAt: true, updatedAt: true,
        _count: { select: { memberships: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ organizations });
  } catch (error) { next(error); }
}

export async function createIamOrganization(req, res, next) {
  try {
    await assertPlatformAdmin(req);
    const { name, slug, externalSystem = null, externalId = null, metadata = null } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
      throw new ValidationError('name must contain 1 to 200 characters');
    }
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) {
      throw new ValidationError('slug must be lowercase letters, numbers, and single hyphens');
    }
    if ((externalSystem === null) !== (externalId === null)) {
      throw new ValidationError('externalSystem and externalId must be provided together');
    }
    if (externalSystem !== null && (typeof externalSystem !== 'string' || externalSystem.length > 100 || typeof externalId !== 'string' || externalId.length > 255)) {
      throw new ValidationError('external organization identifiers are invalid');
    }
    try {
      const organization = await prisma.iamOrganization.create({
        data: { name: name.trim(), slug, externalSystem, externalId, metadata },
      });
      return res.status(201).json({ organization });
    } catch (error) {
      if (error?.code === 'P2002') throw new ConflictError('An IAM organization already uses this slug or external identifier');
      throw error;
    }
  } catch (error) { next(error); }
}

export async function updateIamOrganization(req, res, next) {
  try {
    await assertPlatformAdmin(req);
    const id = req.params.organizationId || req.params.id;
    const { name, slug, isActive, metadata } = req.body ?? {};
    const existing = await prisma.iamOrganization.findUnique({
      where: { id },
      select: { id: true, isActive: true, externalSystem: true },
    });
    if (!existing) throw new NotFoundError('IAM organization');
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 200)) {
      throw new ValidationError('name must contain 1 to 200 characters');
    }
    if (slug !== undefined && (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100)) {
      throw new ValidationError('slug must be lowercase letters, numbers, and single hyphens');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') throw new ValidationError('isActive must be a boolean');
    const data = {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
    if (!Object.keys(data).length) throw new ValidationError('At least one organization field is required');
    try {
      const organization = await prisma.$transaction(async (tx) => {
        const updated = await tx.iamOrganization.update({ where: { id }, data });
        if (
          isActive !== undefined && isActive !== existing.isActive &&
          process.env.IAM_IDENTITY_OUTBOX_ENABLED === 'true'
        ) {
          const memberships = await tx.iamMembership.findMany({
            where: { organizationId: id },
            select: { subjectId: true },
          });
          for (const { subjectId } of memberships) {
            await enqueueIdentitySnapshot(subjectId, 'upsert', tx);
          }
        }
        return updated;
      });
      return res.json({ organization });
    } catch (error) {
      if (error?.code === 'P2002') throw new ConflictError('An IAM organization already uses this slug');
      throw error;
    }
  } catch (error) { next(error); }
}

export async function addIamOrganizationMember(req, res, next) {
  try {
    await assertPlatformAdmin(req);
    const { organizationId } = req.params;
    const { subjectId, status = 'active' } = req.body ?? {};
    if (!UUID_PATTERN.test(organizationId)) throw new ValidationError('organizationId must be a UUID');
    if (typeof subjectId !== 'string' || !UUID_PATTERN.test(subjectId)) throw new ValidationError('subjectId must be a UUID');
    if (!membershipStatuses.has(status)) throw new ValidationError('Unsupported membership status');

    const [organization, subject] = await Promise.all([
      prisma.iamOrganization.findUnique({ where: { id: organizationId }, select: { id: true, isActive: true } }),
      prisma.user.findUnique({ where: { id: subjectId }, select: { id: true, isActive: true } }),
    ]);
    if (!organization) throw new NotFoundError('IAM organization');
    if (!organization.isActive) throw new ValidationError('Cannot add members to an inactive IAM organization');
    if (!subject) throw new NotFoundError('Identity');
    if (status === 'active' && !subject.isActive) throw new ValidationError('An inactive identity cannot receive an active membership');

    const membership = await prisma.$transaction(async (tx) => {
      const row = await tx.iamMembership.upsert({
        where: { subjectId_organizationId: { subjectId, organizationId } },
        create: { subjectId, organizationId, status },
        update: { status },
        select: { id: true, subjectId: true, organizationId: true, status: true, createdAt: true, updatedAt: true },
      });
      await enqueueIdentitySnapshot(subjectId, 'upsert', tx);
      return row;
    });
    return res.status(200).json({ membership });
  } catch (error) { next(error); }
}

export async function updateIamOrganizationMember(req, res, next) {
  try {
    await assertPlatformAdmin(req);
    const { organizationId, subjectId } = req.params;
    const { status } = req.body ?? {};
    if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(subjectId)) throw new ValidationError('organizationId and subjectId must be UUIDs');
    if (!membershipStatuses.has(status)) throw new ValidationError('Unsupported membership status');

    const existing = await prisma.iamMembership.findUnique({
      where: { subjectId_organizationId: { subjectId, organizationId } },
      select: { id: true, subjectId: true, organizationId: true },
    });
    if (!existing) throw new NotFoundError('IAM membership');
    if (status === 'active') {
      const subject = await prisma.user.findUnique({ where: { id: subjectId }, select: { isActive: true } });
      if (!subject?.isActive) throw new ValidationError('An inactive identity cannot receive an active membership');
    }
    const membership = await prisma.$transaction(async (tx) => {
      const row = await tx.iamMembership.update({
        where: { id: existing.id },
        data: { status },
        select: { id: true, subjectId: true, organizationId: true, status: true, createdAt: true, updatedAt: true },
      });
      await enqueueIdentitySnapshot(subjectId, 'upsert', tx);
      return row;
    });
    return res.json({ membership });
  } catch (error) { next(error); }
}

export async function listIamOrganizationMembers(req, res, next) {
  try {
    await assertPlatformAdmin(req);
    const { organizationId } = req.params;
    if (!UUID_PATTERN.test(organizationId)) throw new ValidationError('organizationId must be a UUID');
    const organization = await prisma.iamOrganization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new NotFoundError('IAM organization');
    const memberships = await prisma.iamMembership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, subjectId: true, status: true, createdAt: true, updatedAt: true,
        subject: { select: { email: true, firstName: true, lastName: true, isActive: true } },
      },
    });
    return res.json({ memberships });
  } catch (error) { next(error); }
}
