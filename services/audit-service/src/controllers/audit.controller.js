import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import EventBus from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'audit-service');

export async function getAuditLogs(req, res, next) {
  try {
    const { tenantId, entityType, entityId, userId, action, startDate, endDate } = req.query;
    const where = {
      ...(tenantId && { tenantId }),
      ...(entityType && { entityType }),
      ...(entityId && { entityId }),
      ...(userId && { userId }),
      ...(action && { action }),
      ...(startDate || endDate) && {
        createdAt: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      },
    };
    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        tenant: true,
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: parseInt(req.query.limit) || 100,
      skip: parseInt(req.query.offset) || 0,
    });
    res.json({ logs });
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
