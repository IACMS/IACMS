import prisma from '../config/database.js';
import { NotFoundError } from '../../../../shared/common/errors.js';

export async function getTenant(req, res, next) {
  try {
    const { id } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    res.json({ tenant });
  } catch (error) {
    next(error);
  }
}

export async function validateTenant(req, res, next) {
  try {
    const { code } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { code },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
      },
    });

    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    res.json({ 
      valid: tenant.isActive,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        code: tenant.code,
      },
    });
  } catch (error) {
    next(error);
  }
}

