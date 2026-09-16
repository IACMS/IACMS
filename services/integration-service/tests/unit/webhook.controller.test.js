import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  default: {
    webhook: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const { mockPublish } = vi.hoisted(() => ({
  mockPublish: vi.fn(),
}));
vi.mock('../../../../shared/utils/eventBus.js', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      publish: mockPublish,
    })),
  };
});

import prisma from '../../src/config/database.js';
import EventBus from '../../../../shared/utils/eventBus.js';
import {
  getWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
} from '../../src/controllers/webhook.controller.js';

describe('Webhook Controller Unit Tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPublish.mockClear();
    req = {
      params: {},
      query: {},
      body: {},
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('getWebhooks', () => {
    it('returns a list of webhooks based on query params', async () => {
      req.query = { tenantId: 'tenant-123', isActive: 'true' };
      const mockWebhooks = [{ id: 'wh-1' }, { id: 'wh-2' }];
      prisma.webhook.findMany.mockResolvedValue(mockWebhooks);

      await getWebhooks(req, res, next);

      expect(prisma.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-123', isActive: true },
        })
      );
      expect(res.json).toHaveBeenCalledWith({ webhooks: mockWebhooks });
    });

    it('handles errors via next()', async () => {
      const error = new Error('Database Error');
      prisma.webhook.findMany.mockRejectedValue(error);

      await getWebhooks(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getWebhook', () => {
    it('returns a webhook by id', async () => {
      req.params = { id: 'wh-1' };
      const mockWebhook = { id: 'wh-1' };
      prisma.webhook.findUnique.mockResolvedValue(mockWebhook);

      await getWebhook(req, res, next);

      expect(prisma.webhook.findUnique).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        include: { tenant: true, creator: true },
      });
      expect(res.json).toHaveBeenCalledWith({ webhook: mockWebhook });
    });

    it('throws NotFoundError if webhook does not exist', async () => {
      req.params = { id: 'wh-invalid' };
      prisma.webhook.findUnique.mockResolvedValue(null);

      await getWebhook(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'NotFoundError' }));
    });
  });

  describe('createWebhook', () => {
    it('creates a webhook and publishes an event', async () => {
      req.body = { url: 'https://example.com/hook', events: ['case.created'] };
      const mockWebhook = { id: 'wh-1', tenantId: 'tenant-123', url: 'https://example.com/hook' };
      prisma.webhook.create.mockResolvedValue(mockWebhook);

      await createWebhook(req, res, next);

      expect(prisma.webhook.create).toHaveBeenCalledWith({
        data: req.body,
        include: { tenant: true, creator: true },
      });
      expect(mockPublish).toHaveBeenCalledWith('webhook.created', {
        webhookId: 'wh-1',
        tenantId: 'tenant-123',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ webhook: mockWebhook });
    });
  });

  describe('updateWebhook', () => {
    it('updates a webhook and publishes an event', async () => {
      req.params = { id: 'wh-1' };
      req.body = { isActive: false };
      const mockWebhook = { id: 'wh-1', isActive: false };
      prisma.webhook.update.mockResolvedValue(mockWebhook);

      await updateWebhook(req, res, next);

      expect(prisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: req.body,
      });
      expect(mockPublish).toHaveBeenCalledWith('webhook.updated', {
        webhookId: 'wh-1',
      });
      expect(res.json).toHaveBeenCalledWith({ webhook: mockWebhook });
    });
  });

  describe('deleteWebhook', () => {
    it('deletes a webhook', async () => {
      req.params = { id: 'wh-1' };
      prisma.webhook.delete.mockResolvedValue({});

      await deleteWebhook(req, res, next);

      expect(prisma.webhook.delete).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
      });
      expect(res.json).toHaveBeenCalledWith({ message: 'Webhook deleted' });
    });
  });

  describe('testWebhook', () => {
    it('publishes a test event if webhook exists', async () => {
      req.params = { id: 'wh-1' };
      const mockWebhook = { id: 'wh-1', url: 'https://example.com/hook' };
      prisma.webhook.findUnique.mockResolvedValue(mockWebhook);

      await testWebhook(req, res, next);

      expect(mockPublish).toHaveBeenCalledWith('webhook.test', {
        webhookId: 'wh-1',
        url: 'https://example.com/hook',
      });
      expect(res.json).toHaveBeenCalledWith({ message: 'Test webhook event published' });
    });

    it('throws NotFoundError if webhook is missing', async () => {
      req.params = { id: 'wh-invalid' };
      prisma.webhook.findUnique.mockResolvedValue(null);

      await testWebhook(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'NotFoundError' }));
    });
  });
});
