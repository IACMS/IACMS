import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
} from '../../../../shared/common/errors.js';
import { TOPICS } from '../../../../shared/utils/eventBus.js';
import { getEventBus, generateTemporaryPassword, JWT_SECRET } from '../utils/auth.helpers.js';
import { withAuditClient } from '../utils/audit.helpers.js';
import {
  resolvePlatformActor,
  assertNotPlatformTenant,
  PLATFORM_TENANT_CODE,
} from '../utils/platformAuth.js';


const SERVICE_URLS = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  rbac: process.env.RBAC_SERVICE_URL || 'http://localhost:3002',
  case: process.env.CASE_SERVICE_URL || 'http://localhost:3003',
  workflow: process.env.WORKFLOW_SERVICE_URL || 'http://localhost:3004',
  referral: process.env.REFERRAL_SERVICE_URL || 'http://localhost:3005',
  audit: process.env.AUDIT_SERVICE_URL || 'http://localhost:3006',
  integration: process.env.INTEGRATION_SERVICE_URL || 'http://localhost:3007',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008',
  file: process.env.FILE_SERVICE_URL || 'http://localhost:3009',
};

async function probeHealth(baseUrl) {
  const target = baseUrl.replace(/\/$/, '');
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(`${target}/health`, { signal: ac.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function summarizeServiceHealth() {
  const entries = Object.entries(SERVICE_URLS);
  const results = await Promise.all(
    entries.map(async ([key, url]) => {
      const r = await probeHealth(url);
      return { key, ok: r.ok };
    }),
  );
  const up = results.filter((r) => r.ok).length;
  const down = results.length - up;
  return { up, down, total: results.length, services: results };
}

async function getTenantAdminRoleIds() {
  const rows = await prisma.role.findMany({
    where: { name: 'tenant_admin', tenantId: null, isActive: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function pendingOnboardingCount(tenantAdminRoleIds) {
  if (!tenantAdminRoleIds.length) return 0;

  const rows = await prisma.user.findMany({
    where: {
      mustChangePassword: true,
      isActive: true,
      userRoles: { some: { roleId: { in: tenantAdminRoleIds } } },
      tenant: { code: { not: PLATFORM_TENANT_CODE } },
    },
    select: { tenantId: true },
    distinct: ['tenantId'],
  });
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/dashboard
// ─────────────────────────────────────────────────────────────────────────────
export async function getPlatformDashboard(req, res, next) {
  try {
    const actor = await resolvePlatformActor(req);

    const [tenants, tenantAdminRoleIds, serviceHealth, platformTenant] = await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          createdAt: true,
          registeredByUserId: true,
        },
      }),
      getTenantAdminRoleIds(),
      summarizeServiceHealth(),
      prisma.tenant.findFirst({
        where: { code: PLATFORM_TENANT_CODE },
        select: { id: true },
      }),
    ]);

    const operationalTenants = tenants.filter((t) => t.code !== PLATFORM_TENANT_CODE);
    const activeTenants = operationalTenants.filter((t) => t.isActive !== false).length;
    const inactiveTenantsCount = operationalTenants.filter((t) => t.isActive === false).length;

    const pending = await pendingOnboardingCount(tenantAdminRoleIds);

    // Total users across all operational tenants
    const totalUsersAgg = await prisma.user.aggregate({
      where: {
        tenantId: { not: platformTenant?.id ?? '' },
        isActive: true,
      },
      _count: { id: true },
    });

    // Platform (super-admin) users count
    const platformUsersCount = platformTenant
      ? await prisma.user.count({ where: { tenantId: platformTenant.id, isActive: true } })
      : 0;

    const recentSlice = operationalTenants.slice(0, 10);
    const adminEmailsByTenant = new Map();

    if (recentSlice.length && tenantAdminRoleIds.length) {
      const admins = await prisma.user.findMany({
        where: {
          tenantId: { in: recentSlice.map((t) => t.id) },
          userRoles: { some: { roleId: { in: tenantAdminRoleIds } } },
          isActive: true,
        },
        select: { tenantId: true, email: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      for (const u of admins) {
        if (!adminEmailsByTenant.has(u.tenantId)) {
          adminEmailsByTenant.set(u.tenantId, u.email);
        }
      }
    }

    const recentRegistrations = recentSlice.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      createdAt: t.createdAt.toISOString(),
      isActive: t.isActive !== false,
      adminEmail: adminEmailsByTenant.get(t.id) ?? null,
    }));

    // ── Chart data ──────────────────────────────────────────────────────────
    // 1. Monthly tenant registration trend (last 6 months)
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const label = monthStart.toLocaleString('en-US', { month: 'short', year: '2-digit' });
      const count = operationalTenants.filter((t) => {
        const d = new Date(t.createdAt);
        return d >= monthStart && d <= monthEnd;
      }).length;
      monthlyTrend.push({ month: label, registrations: count });
    }

    // 2. User distribution across top-10 agencies (for bar chart)
    let tenantUserCounts = [];
    if (operationalTenants.length > 0) {
      const userCounts = await prisma.user.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { in: operationalTenants.map((t) => t.id), not: platformTenant?.id ?? '' },
          isActive: true,
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 8,
      });
      const tenantMap = new Map(operationalTenants.map((t) => [t.id, t]));
      tenantUserCounts = userCounts.map((u) => ({
        name: tenantMap.get(u.tenantId)?.code ?? '—',
        users: u._count.id,
      }));
    }

    // 3. Tenant status breakdown for pie chart
    const tenantStatusBreakdown = [
      { name: 'Active', value: activeTenants, color: '#10b981' },
      { name: 'Suspended', value: inactiveTenantsCount, color: '#f59e0b' },
    ];

    res.json({
      success: true,
      data: {
        totalTenants: operationalTenants.length,
        activeTenants,
        inactiveTenantsCount,
        pendingOnboardingCount: pending,
        totalUsersAcrossPlatform: totalUsersAgg._count.id,
        platformUsersCount,
        recentRegistrations,
        serviceHealth,
        // chart payloads
        monthlyTrend,
        tenantUserCounts,
        tenantStatusBreakdown,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/users
// ─────────────────────────────────────────────────────────────────────────────
export async function listPlatformUsers(req, res, next) {
  try {
    await resolvePlatformActor(req);

    const platformTenant = await prisma.tenant.findFirst({
      where: { code: PLATFORM_TENANT_CODE },
      select: { id: true },
    });
    if (!platformTenant) throw new NotFoundError('Platform tenant');

    const users = await prisma.user.findMany({
      where: { tenantId: platformTenant.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        userRoles: {
          select: { role: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      isActive: u.isActive,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
      roles: (u.userRoles ?? []).map((ur) => ur.role).filter(Boolean),
    }));

    res.json({ success: true, data: { users: formatted } });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /platform/users
// ─────────────────────────────────────────────────────────────────────────────
export async function createPlatformUser(req, res, next) {
  try {
    const actorData = await resolvePlatformActor(req);

    const platformTenant = await prisma.tenant.findFirst({
      where: { code: PLATFORM_TENANT_CODE },
      select: { id: true },
    });
    if (!platformTenant) throw new NotFoundError('Platform tenant');

    const { email, firstName, lastName } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new ValidationError('email is required');
    }
    if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
      throw new ValidationError('firstName is required');
    }
    if (!lastName || typeof lastName !== 'string' || !lastName.trim()) {
      throw new ValidationError('lastName is required');
    }

    const emailLower = email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { email: emailLower, tenantId: platformTenant.id },
    });
    if (existing) throw new ConflictError('A platform user with this email already exists');

    // Find system_admin role
    const systemAdminRole = await prisma.role.findFirst({
      where: { name: 'system_admin', isActive: true },
      select: { id: true },
    });
    if (!systemAdminRole) {
      throw new ValidationError('system_admin role not found — run seed migrations');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const uname = emailLower.split('@')[0].toLowerCase();

    const newUser = await prisma.$transaction(async (tx) => {
      const userRow = await tx.user.create({
        data: {
          tenantId: platformTenant.id,
          email: emailLower,
          username: uname,
          passwordHash,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          isActive: true,
          isEmailVerified: false,
          mustChangePassword: true,
        },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          isActive: true, createdAt: true, mustChangePassword: true,
        },
      });

      await tx.userRole.create({
        data: {
          userId: userRow.id,
          roleId: systemAdminRole.id,
          assignedBy: actorData.actorUserId ?? req.user?.id,
        },
      });

      return userRow;
    });

    // Publish event for welcome email
    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.USER_CREATED, {
        userId: newUser.id,
        tenantId: platformTenant.id,
        email: newUser.email,
        firstName: newUser.firstName,
        tenantName: 'Platform Administration',
        tenantCode: PLATFORM_TENANT_CODE,
        temporaryPassword,
        source: 'platform_user_create',
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      data: {
        user: {
          ...newUser,
          roles: [{ id: systemAdminRole.id, name: 'system_admin' }],
        },
      },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return next(new ConflictError('Email or username already in use'));
    }
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /platform/users/:userId
// ─────────────────────────────────────────────────────────────────────────────
export async function updatePlatformUser(req, res, next) {
  try {
    const actorData = await resolvePlatformActor(req);
    const { userId } = req.params;

    const platformTenant = await prisma.tenant.findFirst({
      where: { code: PLATFORM_TENANT_CODE },
      select: { id: true },
    });
    if (!platformTenant) throw new NotFoundError('Platform tenant');

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: platformTenant.id },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    });
    if (!user) throw new NotFoundError('Platform user');

    const { firstName, lastName, isActive } = req.body || {};
    const patch = {};
    if (firstName !== undefined) {
      const v = String(firstName).trim();
      if (!v) throw new ValidationError('firstName cannot be empty');
      patch.firstName = v;
    }
    if (lastName !== undefined) {
      const v = String(lastName).trim();
      if (!v) throw new ValidationError('lastName cannot be empty');
      patch.lastName = v;
    }
    if (isActive !== undefined) {
      // Prevent self-deactivation
      const actorId = actorData.actorUserId ?? req.user?.id;
      if (userId === actorId && isActive === false) {
        throw new ForbiddenError('You cannot deactivate your own account');
      }
      patch.isActive = Boolean(isActive);
    }

    if (Object.keys(patch).length === 0) {
      throw new ValidationError('At least one field is required');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: patch,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        isActive: true, lastLogin: true, createdAt: true,
      },
    });

    res.json({ success: true, data: { user: updated } });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /platform/users/:userId
// ─────────────────────────────────────────────────────────────────────────────
export async function deletePlatformUser(req, res, next) {
  try {
    const actorData = await resolvePlatformActor(req);
    const { userId } = req.params;

    const actorId = actorData.actorUserId ?? req.user?.id;
    if (userId === actorId) {
      throw new ForbiddenError('You cannot delete your own account');
    }

    const platformTenant = await prisma.tenant.findFirst({
      where: { code: PLATFORM_TENANT_CODE },
      select: { id: true },
    });
    if (!platformTenant) throw new NotFoundError('Platform tenant');

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: platformTenant.id },
    });
    if (!user) throw new NotFoundError('Platform user');

    // Soft-delete: deactivate rather than hard delete
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    res.json({ success: true, message: 'Platform user deactivated' });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /platform/tenants/:tenantId/status
// ─────────────────────────────────────────────────────────────────────────────
export async function setTenantStatus(req, res, next) {
  try {
    const actorData = await resolvePlatformActor(req);
    const { tenantId } = req.params;
    const { isActive } = req.body || {};

    if (typeof isActive !== 'boolean') {
      throw new ValidationError('isActive (boolean) is required');
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!tenant) throw new NotFoundError('Tenant');

    if (tenant.code === PLATFORM_TENANT_CODE) {
      throw new ForbiddenError('Cannot modify the status of the platform tenant');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const tenantResult = await tx.tenant.update({
        where: { id: tenantId },
        data: { isActive },
        select: { id: true, name: true, code: true, isActive: true },
      });

      // Cascade the active/inactive state to every user in the tenant
      await tx.user.updateMany({
        where: { tenantId },
        data: { isActive },
      });

      return tenantResult;
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        action: isActive ? 'tenant.activated' : 'tenant.suspended',
        userId: actorData.actorUserId ?? req.user?.id,
        oldValues: { isActive: tenant.isActive },
        newValues: { isActive },
        metadata: {},
      }).catch(() => {});
    }

    res.json({ success: true, data: { tenant: updated } });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /platform/tenants/:tenantId  (soft-delete)
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteTenant(req, res, next) {
  try {
    const actorData = await resolvePlatformActor(req);
    const { tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true },
    });
    if (!tenant) throw new NotFoundError('Tenant');

    if (tenant.code === PLATFORM_TENANT_CODE) {
      throw new ForbiddenError('Cannot delete the platform tenant');
    }

    // Soft-delete: deactivate the tenant and all its users
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: tenantId },
        data: { isActive: false },
      }),
      prisma.user.updateMany({
        where: { tenantId },
        data: { isActive: false },
      }),
    ]);

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        action: 'tenant.deleted',
        userId: actorData.actorUserId ?? req.user?.id,
        oldValues: { code: tenant.code, name: tenant.name },
        newValues: { isActive: false },
        metadata: { soft: true },
      }).catch(() => {});
    }

    res.json({ success: true, message: `Tenant "${tenant.name}" has been deactivated` });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/stats
// ─────────────────────────────────────────────────────────────────────────────
export async function getTenantPlatformStats(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true, isActive: true, createdAt: true },
    });
    if (!tenant) throw new NotFoundError('Tenant');

    const [userAgg, departmentCount, publishedWorkflowCount, referralRows] = await Promise.all([
      prisma.user.aggregate({
        where: { tenantId, isActive: true },
        _count: { id: true },
        _max: { lastLogin: true },
      }),
      prisma.department.count({ where: { tenantId, isActive: true } }),
      prisma.workflow.count({ where: { tenantId, status: 'PUBLISHED' } }),
      prisma.caseReferral.findMany({
        where: {
          OR: [{ fromTenantId: tenantId }, { toTenantId: tenantId }],
        },
        select: { fromTenantId: true, toTenantId: true },
      }),
    ]);

    const partnerIds = new Set();
    for (const r of referralRows) {
      if (r.fromTenantId === tenantId && r.toTenantId !== tenantId) partnerIds.add(r.toTenantId);
      if (r.toTenantId === tenantId && r.fromTenantId !== tenantId) partnerIds.add(r.fromTenantId);
    }

    res.json({
      success: true,
      data: {
        tenantId: tenant.id,
        tenantCode: tenant.code,
        tenantName: tenant.name,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
        userCount: userAgg._count.id,
        lastLoginDate: userAgg._max.lastLogin?.toISOString?.() ?? userAgg._max.lastLogin ?? null,
        departmentCount,
        publishedWorkflowCount,
        activeReferralPartners: partnerIds.size,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /platform/impersonate/:tenantId
// ─────────────────────────────────────────────────────────────────────────────
export async function impersonateTenant(req, res, next) {
  try {
    const actorData = await resolvePlatformActor(req);
    const { tenantId } = req.params;

    await assertNotPlatformTenant(tenantId);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!tenant) throw new NotFoundError('Tenant');
    if (!tenant.isActive) throw new ForbiddenError('Cannot impersonate a suspended tenant');

    // Find the tenant_admin user to impersonate
    const tenantAdminRole = await prisma.role.findFirst({
      where: { name: 'tenant_admin', isActive: true },
      select: { id: true },
    });

    const targetUser = await prisma.user.findFirst({
      where: {
        tenantId,
        isActive: true,
        ...(tenantAdminRole ? { userRoles: { some: { roleId: tenantAdminRole.id } } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, tenantId: true, departmentId: true },
    });

    if (!targetUser) throw new NotFoundError('No active admin user found for this tenant');

    // Issue short-lived impersonation token (15 min)
    const impersonationToken = jwt.sign(
      {
        id: targetUser.id,
        tenantId: targetUser.tenantId,
        departmentId: targetUser.departmentId ?? null,
        email: targetUser.email,
        impersonated: true,
        impersonatedBy: actorData.actorUserId,
        mustChangePassword: false,
      },
      JWT_SECRET,
      { expiresIn: '15m' },
    );

    // Write audit log
    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        action: 'platform.tenant.impersonated',
        userId: actorData.actorUserId,
        newValues: { targetUserId: targetUser.id, targetEmail: targetUser.email },
        metadata: { impersonatedBy: actorData.actorUserId },
      }).catch(() => {});
    }

    res.json({
      success: true,
      data: {
        token: impersonationToken,
        tenantCode: tenant.code,
        tenantName: tenant.name,
        targetEmail: targetUser.email,
        expiresInSeconds: 900,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/settings  |  PATCH /platform/settings
// ─────────────────────────────────────────────────────────────────────────────
export async function getPlatformSettings(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const platform = await prisma.tenant.findFirst({
      where: { code: PLATFORM_TENANT_CODE },
      select: { config: true },
    });
    const raw = (platform?.config && typeof platform.config === 'object') ? platform.config : {};
    // Expose only the "settings" sub-object (exclude featureFlags, announcements etc.)
    const settings = raw.settings || {};
    res.json({ success: true, data: { settings } });
  } catch (error) {
    next(error);
  }
}

export async function updatePlatformSettings(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const updates = req.body || {};
    if (typeof updates !== 'object' || Array.isArray(updates)) throw new ValidationError('Settings must be a key-value object');
    const platform = await prisma.tenant.findFirst({
      where: { code: PLATFORM_TENANT_CODE },
      select: { id: true, config: true },
    });
    if (!platform) throw new NotFoundError('Platform tenant');
    const existing = (platform.config && typeof platform.config === 'object') ? { ...platform.config } : {};
    existing.settings = { ...(existing.settings || {}), ...updates };
    await prisma.tenant.update({ where: { id: platform.id }, data: { config: existing } });
    res.json({ success: true, data: { settings: existing.settings } });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Flags stored in Tenant.config.featureFlags
// GET /platform/feature-flags  |  POST /platform/feature-flags
// ─────────────────────────────────────────────────────────────────────────────
export async function getFeatureFlags(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const tenants = await prisma.tenant.findMany({
      where: { code: { not: PLATFORM_TENANT_CODE } },
      select: { id: true, code: true, name: true, config: true },
    });
    const result = tenants.map((t) => ({
      tenantId: t.id,
      tenantCode: t.code,
      tenantName: t.name,
      flags: (t.config && typeof t.config === 'object' && t.config.featureFlags) ? t.config.featureFlags : {},
    }));
    // Also get global flags from platform tenant
    const platform = await prisma.tenant.findFirst({ where: { code: PLATFORM_TENANT_CODE }, select: { config: true } });
    const globalFlags = (platform?.config?.featureFlags) || {};
    res.json({ success: true, data: { global: globalFlags, tenants: result } });
  } catch (error) {
    next(error);
  }
}

export async function setFeatureFlag(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { key, enabled, tenantId } = req.body || {};
    if (!key || typeof key !== 'string') throw new ValidationError('key is required');
    if (typeof enabled !== 'boolean') throw new ValidationError('enabled (boolean) is required');

    let targetId = tenantId ? String(tenantId) : null;
    if (!targetId) {
      const pt = await prisma.tenant.findFirst({ where: { code: PLATFORM_TENANT_CODE }, select: { id: true } });
      if (!pt) throw new NotFoundError('Platform tenant');
      targetId = pt.id;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: targetId }, select: { id: true, config: true } });
    if (!tenant) throw new NotFoundError('Tenant');
    const conf = (tenant.config && typeof tenant.config === 'object') ? { ...tenant.config } : {};
    conf.featureFlags = { ...(conf.featureFlags || {}), [key]: enabled };
    await prisma.tenant.update({ where: { id: targetId }, data: { config: conf } });
    res.json({ success: true, data: { key, enabled, tenantId: targetId } });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Announcements (stored in platform tenant config array)
// ─────────────────────────────────────────────────────────────────────────────
async function getPlatformTenantRecord() {
  return prisma.tenant.findFirst({ where: { code: PLATFORM_TENANT_CODE }, select: { id: true, config: true } });
}

export async function listAnnouncements(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const platform = await getPlatformTenantRecord();
    const announcements = Array.isArray(platform?.config?.announcements) ? platform.config.announcements : [];
    res.json({ success: true, data: { announcements } });
  } catch (error) {
    next(error);
  }
}

export async function getActiveAnnouncements(req, res, next) {
  try {
    const platform = await getPlatformTenantRecord();
    const announcements = Array.isArray(platform?.config?.announcements) ? platform.config.announcements : [];
    
    // Filter only active announcements
    const now = new Date();
    const active = announcements.filter((a) => {
      if (a.expiresAt && new Date(a.expiresAt) < now) return false;
      return true;
    });

    res.json({ success: true, data: { announcements: active } });
  } catch (error) {
    next(error);
  }
}

export async function createAnnouncement(req, res, next) {
  try {
    const actorData = await resolvePlatformActor(req);
    const { title, body, expiresAt } = req.body || {};
    if (!title || !body) throw new ValidationError('title and body are required');
    const platform = await getPlatformTenantRecord();
    if (!platform) throw new NotFoundError('Platform tenant');
    const conf = (platform.config && typeof platform.config === 'object') ? { ...platform.config } : {};
    const announcements = Array.isArray(conf.announcements) ? [...conf.announcements] : [];
    const item = {
      id: crypto.randomUUID(),
      title: String(title).trim(),
      body: String(body).trim(),
      expiresAt: expiresAt || null,
      createdBy: actorData.actorUserId,
      createdAt: new Date().toISOString(),
    };
    conf.announcements = [item, ...announcements].slice(0, 100);
    await prisma.tenant.update({ where: { id: platform.id }, data: { config: conf } });
    res.status(201).json({ success: true, data: { announcement: item } });
  } catch (error) {
    next(error);
  }
}

export async function deleteAnnouncement(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { id } = req.params;
    const platform = await getPlatformTenantRecord();
    if (!platform) throw new NotFoundError('Platform tenant');
    const conf = (platform.config && typeof platform.config === 'object') ? { ...platform.config } : {};
    conf.announcements = (Array.isArray(conf.announcements) ? conf.announcements : []).filter((a) => a.id !== id);
    await prisma.tenant.update({ where: { id: platform.id }, data: { config: conf } });
    res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Support Tickets (stored in platform tenant config)
// ─────────────────────────────────────────────────────────────────────────────
export async function listSupportTickets(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { status } = req.query;
    const platform = await getPlatformTenantRecord();
    let tickets = Array.isArray(platform?.config?.supportTickets) ? platform.config.supportTickets : [];
    if (status) tickets = tickets.filter((t) => t.status === status);
    res.json({ success: true, data: { tickets } });
  } catch (error) {
    next(error);
  }
}

export async function createSupportTicket(req, res, next) {
  try {
    const { title, body, priority, tenantId } = req.body || {};
    if (!title || !body) throw new ValidationError('title and body are required');
    const platform = await getPlatformTenantRecord();
    if (!platform) throw new NotFoundError('Platform tenant');
    const conf = (platform.config && typeof platform.config === 'object') ? { ...platform.config } : {};
    const tickets = Array.isArray(conf.supportTickets) ? [...conf.supportTickets] : [];
    const ticket = {
      id: crypto.randomUUID(),
      title: String(title).trim(),
      body: String(body).trim(),
      status: 'open',
      priority: priority || 'normal',
      tenantId: tenantId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    conf.supportTickets = [ticket, ...tickets].slice(0, 500);
    await prisma.tenant.update({ where: { id: platform.id }, data: { config: conf } });
    res.status(201).json({ success: true, data: { ticket } });
  } catch (error) {
    next(error);
  }
}

export async function updateSupportTicket(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { id } = req.params;
    const { status, priority } = req.body || {};
    const platform = await getPlatformTenantRecord();
    if (!platform) throw new NotFoundError('Platform tenant');
    const conf = (platform.config && typeof platform.config === 'object') ? { ...platform.config } : {};
    const tickets = Array.isArray(conf.supportTickets) ? [...conf.supportTickets] : [];
    const idx = tickets.findIndex((t) => t.id === id);
    if (idx === -1) throw new NotFoundError('Support ticket');
    tickets[idx] = { ...tickets[idx], ...(status && { status }), ...(priority && { priority }), updatedAt: new Date().toISOString() };
    conf.supportTickets = tickets;
    await prisma.tenant.update({ where: { id: platform.id }, data: { config: conf } });
    res.json({ success: true, data: { ticket: tickets[idx] } });
  } catch (error) {
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Quotas (stored in Tenant.config.quota)
// GET  /platform/quotas
// GET  /platform/tenants/:tenantId/quota
// PATCH /platform/tenants/:tenantId/quota
// ─────────────────────────────────────────────────────────────────────────────
export async function getAllTenantQuotas(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const tenants = await prisma.tenant.findMany({
      where: { code: { not: PLATFORM_TENANT_CODE } },
      select: { id: true, code: true, name: true, isActive: true, config: true },
    });
    const result = tenants.map((t) => ({
      tenantId: t.id,
      tenantCode: t.code,
      tenantName: t.name,
      isActive: t.isActive,
      quota: (t.config && typeof t.config === 'object' && t.config.quota)
        ? t.config.quota
        : { storageLimitMb: null, rateLimitMax: null, storageUsedMb: 0 },
    }));
    res.json({ success: true, data: { tenants: result } });
  } catch (error) {
    next(error);
  }
}

export async function getTenantQuota(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { tenantId } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true, config: true },
    });
    if (!tenant) throw new NotFoundError('Tenant');
    const quota = (tenant.config && typeof tenant.config === 'object' && tenant.config.quota)
      ? tenant.config.quota
      : { storageLimitMb: null, rateLimitMax: null, rateLimitWindow: 60, alertThreshold: 80 };
    res.json({ success: true, data: { tenantId: tenant.id, tenantCode: tenant.code, quota } });
  } catch (error) {
    next(error);
  }
}

export async function updateTenantQuota(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { tenantId } = req.params;
    const { storageLimitMb, rateLimitMax, rateLimitWindow, alertThreshold } = req.body || {};
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, config: true } });
    if (!tenant) throw new NotFoundError('Tenant');
    const conf = (tenant.config && typeof tenant.config === 'object') ? { ...tenant.config } : {};
    conf.quota = {
      ...(conf.quota || {}),
      ...(storageLimitMb !== undefined && { storageLimitMb }),
      ...(rateLimitMax !== undefined && { rateLimitMax }),
      ...(rateLimitWindow !== undefined && { rateLimitWindow }),
      ...(alertThreshold !== undefined && { alertThreshold }),
    };
    await prisma.tenant.update({ where: { id: tenantId }, data: { config: conf } });
    res.json({ success: true, data: { quota: conf.quota } });
  } catch (error) {
    next(error);
  }
}

// ── Pending Agencies Approvals ──────────────────────────────────────────────

export async function getPendingAgencies(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const pendingTenants = await prisma.tenant.findMany({
      where: {
        isActive: false,
        config: { path: ['registrationStatus'], equals: 'PENDING_APPROVAL' },
      },
      include: {
        users: { take: 1, select: { id: true, firstName: true, lastName: true, email: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mapped = pendingTenants.map(t => ({
      id: t.id,
      name: t.name,
      code: t.code,
      createdAt: t.createdAt,
      adminUser: t.users[0] || null,
    }));

    res.json({ success: true, pending: mapped });
  } catch (error) {
    next(error);
  }
}

export async function approveAgency(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { users: { select: { id: true, email: true, firstName: true } } },
    });
    if (!tenant) throw new NotFoundError('Tenant');
    
    // Clear the pending status
    const cfg = tenant.config && typeof tenant.config === 'object' && !Array.isArray(tenant.config) ? tenant.config : {};
    delete cfg.registrationStatus;

    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: { isActive: true, config: cfg },
      });
      // Activate associated users
      await tx.user.updateMany({
        where: { tenantId: id },
        data: { isActive: true },
      });
    });

    const bus = getEventBus();
    if (bus && tenant.users.length > 0) {
      const admin = tenant.users[0];
      bus.publish(TOPICS.TENANT_APPROVED, {
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantCode: tenant.code,
        email: admin.email,
        firstName: admin.firstName,
      }).catch(err => logger.warn('Failed to publish TENANT_APPROVED', { error: err.message }));
    }

    res.json({ success: true, message: 'Agency approved and activated.' });
  } catch (error) {
    next(error);
  }
}

export async function declineAgency(req, res, next) {
  try {
    await resolvePlatformActor(req);
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError('Tenant');

    // Make sure we only hard-delete if it's actually pending approval.
    const isPending = tenant.config?.registrationStatus === 'PENDING_APPROVAL' && !tenant.isActive;
    if (!isPending) {
      throw new ValidationError('Only pending agencies can be declined and removed.');
    }

    // Since onDelete: Cascade is established in Prisma schema for most relations, this deletes the tenant + users
    await prisma.tenant.delete({ where: { id } });

    res.json({ success: true, message: 'Agency registration declined and data removed.' });
  } catch (error) {
    next(error);
  }
}
