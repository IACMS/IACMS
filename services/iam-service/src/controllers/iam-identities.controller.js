import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import prisma from '../config/database.js';
import { ConflictError, ForbiddenError, ValidationError } from '#iam/iamErrors.js';
import { assertPlatformAdmin } from './iam-organizations.controller.js';
import { enqueueIdentitySnapshot } from '../identityEvents.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create a credential-bearing identity that has no legacy IACMS tenant. */
export async function createIamIdentity(req, res, next) {
  try {
    await assertPlatformAdmin(req);
    if (process.env.IAM_GLOBAL_IDENTITIES_ENABLED !== 'true') {
      throw new ForbiddenError('Global identity creation is disabled until IAM uses its isolated database');
    }

    const { email, password, firstName, lastName } = req.body ?? {};
    if (typeof email !== 'string' || !emailPattern.test(email) || email.length > 255) {
      throw new ValidationError('email must be a valid address');
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
      throw new ValidationError('password must contain 12 to 200 characters');
    }
    if (typeof firstName !== 'string' || !firstName.trim() || firstName.trim().length > 100) {
      throw new ValidationError('firstName must contain 1 to 100 characters');
    }
    if (typeof lastName !== 'string' || !lastName.trim() || lastName.trim().length > 100) {
      throw new ValidationError('lastName must contain 1 to 100 characters');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw new ConflictError('An identity with this email already exists');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: null,
          email: normalizedEmail,
          username: `iam_${crypto.randomUUID().replaceAll('-', '')}`,
          passwordHash,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          isActive: true,
          isEmailVerified: false,
        },
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          isActive: true, isEmailVerified: true, createdAt: true,
        },
      });
      await enqueueIdentitySnapshot(created.id, 'upsert', tx);
      return created;
    });

    return res.status(201).json({ identity: user });
  } catch (error) {
    if (error?.code === 'P2002') return next(new ConflictError('An identity with this email already exists'));
    return next(error);
  }
}
