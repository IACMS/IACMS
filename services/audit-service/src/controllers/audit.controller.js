import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../shared/common/errors.js';
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');

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

