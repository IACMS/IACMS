import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../shared/common/errors.js';
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');

export async function getWebhooks(req, res, next) {
  try {
    const { tenantId, isActive } = req.query;
    const webhooks = await prisma.webhook.findMany({
      where: {
        ...(tenantId && { tenantId }),
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
      },
      include: {
        tenant: true,
        creator: true,
      },
    });
    res.json({ webhooks });
  } catch (error) {
    next(error);
  }
}

export async function getWebhook(req, res, next) {
  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        creator: true,
      },
    });
    if (!webhook) throw new NotFoundError('Webhook');
    res.json({ webhook });
  } catch (error) {
    next(error);
  }
}

export async function createWebhook(req, res, next) {
  try {
    const webhook = await prisma.webhook.create({
      data: req.body,
      include: {
        tenant: true,
        creator: true,
      },
    });
    await eventBus.publish('webhook.created', {
      webhookId: webhook.id,
      tenantId: webhook.tenantId,
    });
    res.status(201).json({ webhook });
  } catch (error) {
    next(error);
  }
}

export async function updateWebhook(req, res, next) {
  try {
    const webhook = await prisma.webhook.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await eventBus.publish('webhook.updated', { webhookId: webhook.id });
    res.json({ webhook });
  } catch (error) {
    next(error);
  }
}

export async function deleteWebhook(req, res, next) {
  try {
    await prisma.webhook.delete({ where: { id: req.params.id } });
    res.json({ message: 'Webhook deleted' });
  } catch (error) {
    next(error);
  }
}

export async function testWebhook(req, res, next) {
  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: req.params.id },
    });
    if (!webhook) throw new NotFoundError('Webhook');
    
    // Publish test event
    await eventBus.publish('webhook.test', {
      webhookId: webhook.id,
      url: webhook.url,
    });
    
    res.json({ message: 'Test webhook event published' });
  } catch (error) {
    next(error);
  }
}

