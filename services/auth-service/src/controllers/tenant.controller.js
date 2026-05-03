import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';
import { TOPICS } from '../../../../shared/utils/eventBus.js';
import { getEventBus, generateTokens } from '../utils/auth.helpers.js';
import { validateTenantRegistrationRequest } from '../utils/validators.js';

const logger = new Logger('auth-service');

async function userMayConfigureTenant(roleIds) {
  if (!roleIds?.length) return false;
  const roles = await prisma.role.findMany({
    where: { id: { in: roleIds }, isActive: true },
    select: { name: true },
  });
  return roles.some((r) => r.name === 'tenant_admin' || r.name === 'system_admin');
}

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
        config: true,
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

export async function updateTenantConfig(req, res, next) {
  try {
    const { id } = req.params;
    const userTenantId = req.headers['x-tenant-id'] || req.user?.tenantId;
    const roleIds = Array.isArray(req.user?.roles) ? req.user.roles : [];

    if (!userTenantId || id !== userTenantId) {
      return res.status(403).json({ error: { message: 'You can only update your own tenant configuration' } });
    }

    if (!(await userMayConfigureTenant(roleIds))) {
      return res.status(403).json({
        error: { message: 'Only tenant administrators or system administrators may edit tenant configuration' },
      });
    }

    const { config } = req.body;
    if (!config) {
      return res.status(400).json({ error: { message: 'Config payload is required' } });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError('Tenant');

    const updatedConfig = { ...((tenant.config && typeof tenant.config === 'object') ? tenant.config : {}), ...config };

    const updated = await prisma.tenant.update({
      where: { id },
      data: { config: updatedConfig },
      select: {
        id: true,
        name: true,
        code: true,
        config: true,
      }
    });

    res.json({ tenant: updated });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /tenants/register
 * Creates a new tenant and first user as **tenant_admin** (organization registrar).
 */
export async function registerTenant(req, res, next) {
  try {
    const payload = validateTenantRegistrationRequest(req.body);

    const existingTenant = await prisma.tenant.findUnique({
      where: { code: payload.tenantCode },
    });
    if (existingTenant) {
      throw new ConflictError('An organization with this tenant code already exists');
    }

    const tenantAdminRole = await prisma.role.findFirst({
      where: { name: 'tenant_admin', tenantId: null },
    });
    if (!tenantAdminRole) {
      throw new ValidationError(
        'Server is missing tenant_admin role — run database migrations and seed'
      );
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);
    const uname =
      payload.username?.trim()?.toLowerCase() ||
      payload.email.split('@')[0].toLowerCase();

    const { tenant, user, roleIds } = await prisma.$transaction(async (tx) => {
      const tenantRow = await tx.tenant.create({
        data: {
          name: payload.tenantName,
          code: payload.tenantCode,
          description: null,
          isActive: true,
        },
      });

      const userRow = await tx.user.create({
        data: {
          tenantId: tenantRow.id,
          email: payload.email,
          username: uname,
          passwordHash,
          firstName: payload.firstName,
          lastName: payload.lastName,
          isActive: true,
          isEmailVerified: false,
        },
      });

      await tx.tenant.update({
        where: { id: tenantRow.id },
        data: { registeredByUserId: userRow.id },
      });

      await tx.userRole.create({
        data: { userId: userRow.id, roleId: tenantAdminRole.id },
      });

      return { tenant: tenantRow, user: userRow, roleIds: [tenantAdminRole.id] };
    });

    const { accessToken, refreshToken } = generateTokens(user, roleIds);

    const bus = getEventBus();
    if (bus) {
      bus
        .publish(TOPICS.USER_CREATED, {
          userId: user.id,
          tenantId: tenant.id,
          email: user.email,
          firstName: user.firstName,
          source: 'tenant_register',
        })
        .catch((err) => logger.warn('USER_CREATED publish failed', { error: err.message }));
    }

    logger.info('Tenant registered', {
      tenantId: tenant.id,
      registrarUserId: user.id,
      code: tenant.code,
    });

    res.status(201).json({
      message: 'Organization registered',
      tenant: {
        id: tenant.id,
        name: tenant.name,
        code: tenant.code,
      },
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: roleIds,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return next(new ConflictError('Email or username already in use for this organization'));
    }
    next(error);
  }
}
