import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      webhook: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

import prisma from '../../src/config/database.js';
import {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  signPayload,
  SUPPORTED_EVENTS,
} from '../../src/services/webhook.service.js';

describe('Webhook Service (api-gateway)', () => {
  const tenantId = 't-1';
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createWebhook', () => {
    it('creates a webhook and returns it along with the secret', async () => {
      const payload = {
        name: 'Test Hook',
        url: 'https://example.com/hook',
        events: ['case.created'],
        createdBy: 'user-1',
      };
      
      const mockWebhook = { id: 'wh-1', ...payload };
      prisma.webhook.create.mockResolvedValue(mockWebhook);
      
      const result = await createWebhook(tenantId, payload);
      
      expect(prisma.webhook.create).toHaveBeenCalled();
      expect(result.webhook).toEqual(mockWebhook);
      expect(result.secret).toBeDefined();
      expect(result.secret.length).toBe(64); // 32 bytes hex = 64 chars
    });

    it('throws ValidationError if url is invalid', async () => {
      await expect(
        createWebhook(tenantId, { name: 'Test', url: 'ftp://bad', events: ['case.created'] })
      ).rejects.toThrow('Webhook URL must use http or https');
    });

    it('throws ValidationError if events are invalid', async () => {
      await expect(
        createWebhook(tenantId, { name: 'Test', url: 'https://ex.com', events: ['bad.event'] })
      ).rejects.toThrow('Unsupported event types');
    });
  });

  describe('listWebhooks', () => {
    it('returns a list of webhooks for a tenant', async () => {
      const mockWebhooks = [{ id: 'wh-1' }];
      prisma.webhook.findMany.mockResolvedValue(mockWebhooks);
      
      const res = await listWebhooks(tenantId);
      expect(prisma.webhook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId } }));
      expect(res).toEqual(mockWebhooks);
    });
  });

  describe('getWebhook', () => {
    it('returns a webhook by id and tenant', async () => {
      const mockWebhook = { id: 'wh-1' };
      prisma.webhook.findFirst.mockResolvedValue(mockWebhook);
      
      const res = await getWebhook('wh-1', tenantId);
      expect(res).toEqual(mockWebhook);
    });
  });

  describe('updateWebhook', () => {
    it('updates a webhook', async () => {
      const mockWebhook = { id: 'wh-1', name: 'Old' };
      prisma.webhook.findFirst.mockResolvedValue(mockWebhook);
      prisma.webhook.update.mockResolvedValue({ ...mockWebhook, name: 'New' });
      
      const res = await updateWebhook('wh-1', tenantId, { name: 'New' });
      expect(prisma.webhook.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'wh-1' },
        data: expect.objectContaining({ name: 'New' }),
      }));
      expect(res.name).toBe('New');
    });

    it('throws NotFoundError if webhook missing', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);
      await expect(updateWebhook('wh-1', tenantId, {})).rejects.toThrow('Webhook');
    });
  });

  describe('deleteWebhook', () => {
    it('deletes a webhook', async () => {
      const mockWebhook = { id: 'wh-1' };
      prisma.webhook.findFirst.mockResolvedValue(mockWebhook);
      
      await deleteWebhook('wh-1', tenantId);
      expect(prisma.webhook.delete).toHaveBeenCalledWith({ where: { id: 'wh-1' } });
    });
  });

  describe('signPayload', () => {
    it('correctly computes HMAC signature', () => {
      const secret = 'supersecret';
      const body = JSON.stringify({ key: 'value' });
      const signature = signPayload(secret, body);
      
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(signature).toBe(expected);
    });
  });
});
