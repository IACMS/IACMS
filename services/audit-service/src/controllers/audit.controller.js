import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import EventBus from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'audit-service');

const SORT_FIELDS = new Set(['createdAt', 'action', 'entityType', 'entityId']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Build Prisma OR filters for free-text audit search (no invalid UUID `contains`). */
export function buildAuditSearchOr(q) {
  const or = [
    { action: { contains: q, mode: 'insensitive' } },
    { entityType: { contains: q, mode: 'insensitive' } },
    { user: { email: { contains: q, mode: 'insensitive' } } },
    { user: { firstName: { contains: q, mode: 'insensitive' } } },
    { user: { lastName: { contains: q, mode: 'insensitive' } } },
  ];
  if (UUID_RE.test(q)) {
    or.push({ entityId: q });
    or.push({ userId: q });
  }
  return or;
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && String(value).length <= 10) {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

function buildTenantScope(tenantId, callerTenant) {
  const scope = tenantId || callerTenant;
  if (!scope) return {};
  return {
    OR: [{ tenantId: scope }, { relatedTenantId: scope }],
  };
}

export async function getAuditLogs(req, res, next) {
  try {
    const callerTenant = req.headers['x-tenant-id'] ? String(req.headers['x-tenant-id']) : null;
    const {
      tenantId,
      entityType,
      entityId,
      userId,
      action,
      startDate,
      endDate,
      search,
      sortBy,
      sortDir,
    } = req.query;

    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    // Parse comma-separated action substrings to exclude (e.g. "login,logout,password")
    const excludeActionsRaw = req.query.excludeActions ? String(req.query.excludeActions) : '';
    const excludePatterns = excludeActionsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const where = {
      ...buildTenantScope(tenantId ? String(tenantId) : null, callerTenant),
      ...(entityType && { entityType: String(entityType) }),
      ...(entityId && { entityId: String(entityId) }),
      ...(userId && { userId: String(userId) }),
      ...(action && { action: { contains: String(action), mode: 'insensitive' } }),
      // Exclude each pattern: a row is kept only when its action does NOT contain the pattern
      ...(excludePatterns.length > 0 && {
        AND: excludePatterns.map((pattern) => ({
          NOT: { action: { contains: pattern, mode: 'insensitive' } },
        })),
      }),
    };

    const start = parseDate(startDate, false);
    const end = parseDate(endDate, true);
    if (start || end) {
      where.createdAt = {
        ...(start && { gte: start }),
        ...(end && { lte: end }),
      };
    }

    const q = typeof search === 'string' ? search.trim() : '';
    if (q) {
      where.AND = [
        ...(where.AND ?? []),
        { OR: buildAuditSearchOr(q) },
      ];
    }

    const field = SORT_FIELDS.has(String(sortBy)) ? String(sortBy) : 'createdAt';
    const direction = String(sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          tenant: true,
          relatedTenant: true,
          user: true,
        },
        orderBy: { [field]: direction },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      logs,
      total,
      limit,
      offset,
      sortBy: field,
      sortDir: direction,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAuditLog(req, res, next) {
  try {
    const log = await prisma.auditLog.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        relatedTenant: true,
        user: true,
      },
    });
    if (!log) throw new NotFoundError('Audit log');
    res.json({ log });
  } catch (error) {
    next(error);
  }
}

export async function createAuditLog(req, res, next) {
  try {
    const log = await prisma.auditLog.create({
      data: req.body,
      include: {
        tenant: true,
        user: true,
      },
    });
    // Audit logs are immutable, so we don't publish update events
    res.status(201).json({ log });
  } catch (error) {
    next(error);
  }
}

export async function getAuditLogsByEntity(req, res, next) {
  try {
    const { entityType, entityId } = req.params;
    const logs = await prisma.auditLog.findMany({
      where: {
        entityType,
        entityId,
      },
      include: {
        tenant: true,
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json({ logs });
  } catch (error) {
    next(error);
  }
}

export async function getCaseAuditTrail(req, res, next) {
  try {
    const callerTenant = req.headers['x-tenant-id'];
    if (!callerTenant) throw new ValidationError('x-tenant-id required');
    const { caseId } = req.params;
    const logs = await prisma.auditLog.findMany({
      where: {
        entityType: 'case',
        entityId: caseId,
        OR: [{ tenantId: callerTenant }, { relatedTenantId: callerTenant }],
      },
      include: {
        tenant: true,
        relatedTenant: true,
        user: true,
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(parseInt(req.query.limit, 10) || 500, 5000),
    });
    res.json({ logs });
  } catch (e) {
    next(e);
  }
}

export async function getUserAuditActions(req, res, next) {
  try {
    const callerTenant = req.headers['x-tenant-id'];
    if (!callerTenant) throw new ValidationError('x-tenant-id required');
    const { userId } = req.params;
    const { action, from, to } = req.query;
    const logs = await prisma.auditLog.findMany({
      where: {
        tenantId: callerTenant,
        userId,
        ...(action && { action }),
        ...(from || to ?
          {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          } :
          {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(req.query.limit, 10) || 200, 2000),
      skip: parseInt(req.query.offset, 10) || 0,
    });
    res.json({ logs });
  } catch (e) {
    next(e);
  }
}

export async function exportComplianceCsv(req, res, next) {
  try {
    const callerTenant = req.headers['x-tenant-id'];
    if (!callerTenant) throw new ValidationError('x-tenant-id required');
    if (callerTenant !== req.params.tenantId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Tenant mismatch' } });
    }
    const format = req.query.format || 'json';
    const { from, to } = req.query;
    const where = {
      OR: [{ tenantId: req.params.tenantId }, { relatedTenantId: req.params.tenantId }],
      ...(from || to ?
        {
          createdAt: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        } :
        {}),
    };

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 50000,
    });

    if (format !== 'csv') {
      return res.json({ logs });
    }

    const { csvEscape } = await import('../utils/csv.js');
    res.setHeader('Content-Type', 'text/csv');
    res.write(
      'createdAt,tenantId,relatedTenantId,entityType,entityId,action,userId\n',
    );
    for (const row of logs) {
      res.write(
        `${csvEscape(row.createdAt instanceof Date ? row.createdAt.toISOString() : '')},${csvEscape(row.tenantId)},${csvEscape(row.relatedTenantId)},${csvEscape(row.entityType)},${csvEscape(row.entityId)},${csvEscape(row.action)},${csvEscape(row.userId)}\n`,
      );
    }
    res.end();
  } catch (e) {
    next(e);
  }
}
