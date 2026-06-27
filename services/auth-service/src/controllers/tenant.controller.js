import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
} from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';
import { TOPICS } from '../../../../shared/utils/eventBus.js';
import { getEventBus, generateTemporaryPassword } from '../utils/auth.helpers.js';
import { validateTenantRegistrationRequest } from '../utils/validators.js';
import { loadUserRoleIdsForUser } from '../../../../shared/utils/userRoles.js';
import { resolveCanonicalGlobalTenantAdminRole } from '../utils/globalTenantAdminRole.js';

const logger = new Logger('auth-service');

function parseRoleIdsFromHeaders(req) {
  const raw = req.headers['x-user-roles'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Registering agencies requires `system_admin` (gateway forwards role UUIDs via `x-user-roles`,
 * or JWT payload via optional Bearer middleware).
 */
async function assertPlatformAdminRegistrar(req) {
  const registrarId =
    (req.headers['x-user-id'] && String(req.headers['x-user-id'])) || req.user?.id || null;
  if (!registrarId) {
    throw new UnauthorizedError('Authentication required');
  }

  if (req.user?.mustChangePassword) {
    throw new ForbiddenError('You must change your password before registering organizations.');
  }

  const fromHeader = parseRoleIdsFromHeaders(req);
  const fromJwt = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : [];
  const roleIds = [...new Set([...fromHeader, ...fromJwt])];

  if (!roleIds.length) {
    throw new ForbiddenError('Only platform administrators may register new organizations');
  }

  const roles = await prisma.role.findMany({
    where: { id: { in: roleIds }, isActive: true },
    select: { name: true },
  });
  if (!roles.some((r) => r.name === 'system_admin')) {
    throw new ForbiddenError('Only platform administrators may register new organizations');
  }

  return registrarId;
}

async function resolveActorContext(req) {
  const actorUserId = req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null;
  const actorTenantId = req.headers['x-tenant-id'] ? String(req.headers['x-tenant-id']) : null;
  let roleIds = parseRoleIdsFromHeaders(req);

  if (!actorUserId || !actorTenantId) {
    throw new ValidationError('Tenant ID and User ID are required in headers');
  }

  // Gateway should send `x-user-roles`; hydrate from DB when missing (older sessions / partial tokens).
  if (!roleIds.length) {
    roleIds = await loadUserRoleIdsForUser(prisma, actorUserId);
  }

  const roles = roleIds.length
    ? await prisma.role.findMany({
        where: { id: { in: roleIds }, isActive: true },
        select: { name: true },
      })
    : [];

  const isSystemAdmin = roles.some((r) => r.name === 'system_admin');
  const isTenantAdmin = roles.some((r) => r.name === 'tenant_admin');

  return { actorUserId, actorTenantId, roleIds, isSystemAdmin, isTenantAdmin };
}

const BRANDING_KEYS = new Set(['primaryColor', 'secondaryColor', 'logoUrl', 'fontPreference']);
const LETTER_KEYS = new Set(['letterHeader', 'letterFooter', 'letterAddress', 'letterClosing']);
const TENANT_CONFIG_KEYS = new Set([...BRANDING_KEYS, ...LETTER_KEYS]);
const FONT_WHITELIST = new Set(['Inter', 'Roboto', 'Outfit', 'system-ui']);
const LETTER_TEXT_MAX = 5000;

function validateHexColor(value, fieldName) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${fieldName} must be a string`);
  const v = value.trim();
  const ok = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(v);
  if (!ok) throw new ValidationError(`${fieldName} must be a valid hex color like #RRGGBB`);
  return v.toLowerCase();
}

function validateLogoUrl(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ValidationError('logoUrl must be a string');
  const v = value.trim();
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new ValidationError('logoUrl must be a valid URL');
  }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'development' && url.protocol === 'http:')) {
    throw new ValidationError('logoUrl must use https:// (http:// allowed in development only)');
  }
  return v;
}

function validateFontPreference(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ValidationError('fontPreference must be a string');
  const v = value.trim();
  if (!FONT_WHITELIST.has(v)) {
    throw new ValidationError(`fontPreference must be one of: ${[...FONT_WHITELIST].join(', ')}`);
  }
  return v;
}

function validateLetterText(value, fieldName) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${fieldName} must be a string`);
  const v = value.trim();
  if (v.length > LETTER_TEXT_MAX) {
    throw new ValidationError(`${fieldName} must be at most ${LETTER_TEXT_MAX} characters`);
  }
  return v;
}

function pickTenantConfigResponse(cfg) {
  return {
    primaryColor: cfg.primaryColor ?? null,
    secondaryColor: cfg.secondaryColor ?? null,
    logoUrl: cfg.logoUrl ?? null,
    fontPreference: cfg.fontPreference ?? null,
    letterHeader: cfg.letterHeader ?? null,
    letterFooter: cfg.letterFooter ?? null,
    letterAddress: cfg.letterAddress ?? null,
    letterClosing: cfg.letterClosing ?? null,
  };
}

function validateAndPickTenantConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new ValidationError('Config must be an object');
  }

  for (const k of Object.keys(config)) {
    if (!TENANT_CONFIG_KEYS.has(k)) {
      throw new ValidationError(`Unknown config field "${k}"`);
    }
  }

  const next = {};
  if ('primaryColor' in config) next.primaryColor = validateHexColor(config.primaryColor, 'primaryColor');
  if ('secondaryColor' in config) next.secondaryColor = validateHexColor(config.secondaryColor, 'secondaryColor');
  if ('logoUrl' in config) next.logoUrl = validateLogoUrl(config.logoUrl);
  if ('fontPreference' in config) next.fontPreference = validateFontPreference(config.fontPreference);
  if ('letterHeader' in config) next.letterHeader = validateLetterText(config.letterHeader, 'letterHeader');
  if ('letterFooter' in config) next.letterFooter = validateLetterText(config.letterFooter, 'letterFooter');
  if ('letterAddress' in config) next.letterAddress = validateLetterText(config.letterAddress, 'letterAddress');
  if ('letterClosing' in config) next.letterClosing = validateLetterText(config.letterClosing, 'letterClosing');
  return next;
}

/**
 * GET /tenants
 * Lists all organizations. Only `system_admin` (platform operators) may call this.
 * Tenant-scoped users should use GET /tenants/:id for their own tenant.
 */
export async function listTenants(req, res, next) {
  try {
    const { isSystemAdmin } = await resolveActorContext(req);
    if (!isSystemAdmin) {
      throw new ForbiddenError('Only platform administrators may list all organizations');
    }

    const rows = await prisma.tenant.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json({ tenants: rows });
  } catch (error) {
    next(error);
  }
}

export async function getTenant(req, res, next) {
  try {
    const { id } = req.params;
    const { actorTenantId, isSystemAdmin } = await resolveActorContext(req);

    // Tenant boundary: only system admins may read other tenants.
    if (!isSystemAdmin && id !== actorTenantId) {
      throw new NotFoundError('Tenant');
    }

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

    const cfg = tenant.config && typeof tenant.config === 'object' && !Array.isArray(tenant.config) ? tenant.config : {};
    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        code: tenant.code,
        description: tenant.description,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
        config: pickTenantConfigResponse(cfg),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function validateTenant(req, res, next) {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) throw new ValidationError('Tenant code is required');

    const tenant = await prisma.tenant.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
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
    const { actorTenantId, actorUserId, isSystemAdmin, isTenantAdmin } = await resolveActorContext(req);

    // Tenant boundary: tenant admins may only edit their own tenant; system admins may edit any.
    if (!isSystemAdmin && id !== actorTenantId) {
      throw new NotFoundError('Tenant');
    }

    if (!(isSystemAdmin || isTenantAdmin)) {
      throw new ForbiddenError('Only tenant administrators or system administrators may edit tenant configuration');
    }

    const { config } = req.body || {};
    const patch = validateAndPickTenantConfig(config);

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError('Tenant');

    const updatedConfig = {
      ...((tenant.config && typeof tenant.config === 'object' && !Array.isArray(tenant.config)) ? tenant.config : {}),
      ...patch,
    };

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

    const cfg = updated.config && typeof updated.config === 'object' && !Array.isArray(updated.config) ? updated.config : {};
    res.json({
      tenant: {
        id: updated.id,
        name: updated.name,
        code: updated.code,
        config: pickTenantConfigResponse(cfg),
      },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId: updated.id,
        entityType: 'tenant',
        entityId: updated.id,
        action: 'tenant_branding_updated',
        userId: actorUserId,
        oldValues: null,
        newValues: patch,
        metadata: {},
      }).catch(() => {});
    }
  } catch (error) {
    next(error);
  }
}

export async function uploadTenantLogo(req, res, next) {
  try {
    const { id } = req.params;
    const { actorTenantId, actorUserId, isSystemAdmin, isTenantAdmin } = await resolveActorContext(req);

    if (!isSystemAdmin && id !== actorTenantId) {
      throw new NotFoundError('Tenant');
    }

    if (!(isSystemAdmin || isTenantAdmin)) {
      throw new ForbiddenError('Only tenant administrators or system administrators may upload a tenant logo');
    }

    if (!req.file) throw new ValidationError('Logo file is required');

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError('Tenant');

    const relativeUrl = `/api/v1/tenants/assets/tenants/${id}/${req.file.filename}`;

    const currentConfig =
      tenant.config && typeof tenant.config === 'object' && !Array.isArray(tenant.config) ? tenant.config : {};

    const nextConfig = { ...currentConfig, logoUrl: relativeUrl };

    await prisma.tenant.update({
      where: { id },
      data: { config: nextConfig },
      select: { id: true },
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId: id,
        entityType: 'tenant',
        entityId: id,
        action: 'tenant_logo_uploaded',
        userId: actorUserId,
        oldValues: null,
        newValues: { logoUrl: relativeUrl },
        metadata: { filename: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size },
      }).catch(() => {});
    }

    res.status(201).json({ logoUrl: relativeUrl, url: relativeUrl });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /tenants/register
 * Creates a new tenant and first user as **tenant_admin**.
 * **Only `system_admin` (platform operators) may call this** — enforced at API gateway and here.
 */
export async function registerTenant(req, res, next) {
  try {
    const registrarUserId = await assertPlatformAdminRegistrar(req);

    const payload = validateTenantRegistrationRequest(req.body);

    const existingTenant = await prisma.tenant.findUnique({
      where: { code: payload.tenantCode },
    });
    if (existingTenant) {
      throw new ConflictError('An organization with this tenant code already exists');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
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
          mustChangePassword: true,
        },
      });

      await tx.tenant.update({
        where: { id: tenantRow.id },
        data: { registeredByUserId: registrarUserId },
      });

      const tenantAdminRole = await resolveCanonicalGlobalTenantAdminRole(tx);
      if (!tenantAdminRole) {
        throw new ValidationError(
          'Server is missing tenant_admin role — run database migrations and seed',
        );
      }
      if (tenantAdminRole._count.rolePermissions < 1) {
        throw new ValidationError(
          'tenant_admin role has no permissions — run database seed to attach RBAC permissions',
        );
      }

      await tx.userRole.create({
        data: {
          userId: userRow.id,
          roleId: tenantAdminRole.id,
          assignedBy: registrarUserId,
        },
      });

      return {
        tenant: tenantRow,
        user: userRow,
        roleIds: [tenantAdminRole.id],
      };
    });

    const bus = getEventBus();
    if (bus) {
      bus
        .publish(TOPICS.USER_CREATED, {
          userId: user.id,
          tenantId: tenant.id,
          email: user.email,
          firstName: user.firstName,
          tenantName: tenant.name,
          tenantCode: tenant.code,
          temporaryPassword,
          source: 'tenant_register',
        })
        .catch((err) => logger.warn('USER_CREATED publish failed', { error: err.message }));
    }

    logger.info('Tenant registered', {
      tenantId: tenant.id,
      firstTenantUserId: user.id,
      registeredByPlatformUserId: registrarUserId,
      code: tenant.code,
    });

    res.status(201).json({
      message:
        'Organization registered. The first administrator will receive their temporary password by email.',
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
        mustChangePassword: true,
        roles: roleIds,
      },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return next(new ConflictError('Email or username already in use for this organization'));
    }
    next(error);
  }
}
