import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../shared/common/errors.js';
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');

export async function getIntegrations(req, res, next) {
  try {
    const { tenantId, type, isActive } = req.query;
    const integrations = await prisma.integration.findMany({
      where: {
        ...(tenantId && { tenantId }),
        ...(type && { type }),
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
      },
      include: {
        tenant: true,
        creator: true,
      },
    });
    res.json({ integrations });
  } catch (error) {
    next(error);
  }
}

export async function getIntegration(req, res, next) {
  try {
    const integration = await prisma.integration.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        creator: true,
      },
    });
    if (!integration) throw new NotFoundError('Integration');
    // Don't expose sensitive data
    const { apiKey, apiSecret, ...safeIntegration } = integration;
    res.json({ integration: safeIntegration });
  } catch (error) {
    next(error);
  }
}

export async function createIntegration(req, res, next) {
  try {
    const integration = await prisma.integration.create({
      data: req.body,
      include: {
        tenant: true,
        creator: true,
      },
    });
    await eventBus.publish('integration.created', {
      integrationId: integration.id,
      tenantId: integration.tenantId,
      type: integration.type,
    });
    const { apiKey, apiSecret, ...safeIntegration } = integration;
    res.status(201).json({ integration: safeIntegration });
  } catch (error) {
    next(error);
  }
}

export async function updateIntegration(req, res, next) {
  try {
    const integration = await prisma.integration.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await eventBus.publish('integration.updated', { integrationId: integration.id });
    const { apiKey, apiSecret, ...safeIntegration } = integration;
    res.json({ integration: safeIntegration });
  } catch (error) {
    next(error);
  }
}

export async function deleteIntegration(req, res, next) {
  try {
    await prisma.integration.delete({ where: { id: req.params.id } });
    res.json({ message: 'Integration deleted' });
  } catch (error) {
    next(error);
  }
}

export async function syncIntegration(req, res, next) {
  try {
    const integration = await prisma.integration.findUnique({
      where: { id: req.params.id },
    });
    if (!integration) throw new NotFoundError('Integration');
    
    // Update sync status
    const updated = await prisma.integration.update({
      where: { id: req.params.id },
      data: {
        lastSyncAt: new Date(),
        syncStatus: { status: 'syncing', startedAt: new Date().toISOString() },
      },
    });
    
    await eventBus.publish('integration.sync', {
      integrationId: integration.id,
      type: integration.type,
    });
    
    res.json({ message: 'Sync initiated', integration: updated });
  } catch (error) {
    next(error);
  }
}

