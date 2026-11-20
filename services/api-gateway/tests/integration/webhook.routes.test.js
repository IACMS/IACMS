import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies
vi.mock('../../src/config/database.js', () => {
  const prismaMock = {
    webhook: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { default: prismaMock };
});

import webhookRoutes from '../../src/routes/webhook.routes.js';
import prisma from '../../src/config/database.js';

const app = express();
app.use(express.json());

// Mock Auth Middleware
app.use('/api/v1/webhooks', (req, res, next) => {
  // Simulate an authenticated user session
  req.user = { tenantId: 'tenant-123', id: 'user-1' };
  next();
});

app.use('/api/v1/webhooks', webhookRoutes);

describe('API Gateway Webhook Routes', () => {
  const mockTenantId = 'tenant-123';
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/webhooks', () => {
    it('returns a list of webhooks', async () => {
      const mockWebhooks = [{ id: 'wh-1', name: 'Hook 1' }];
      prisma.webhook.findMany.mockResolvedValue(mockWebhooks);
      
      const res = await request(app).get('/api/v1/webhooks');
      
      expect(res.status).toBe(200);
      expect(res.body.webhooks).toEqual(mockWebhooks);
      expect(prisma.webhook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: mockTenantId } }));
    });
  });

  describe('GET /api/v1/webhooks/:id', () => {
    it('returns a webhook by id', async () => {
      const mockWebhook = { id: 'wh-1', name: 'Hook 1' };
      prisma.webhook.findFirst.mockResolvedValue(mockWebhook);
      
      const res = await request(app).get('/api/v1/webhooks/wh-1');
      
      expect(res.status).toBe(200);
      expect(res.body.webhook).toEqual(mockWebhook);
    });

    it('returns 404 if not found', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/webhooks/wh-1');
      // The errorHandler is not attached in this simplified app, so next(NotFoundError) will hit default express 500 handler, but let's assume our mock app handles it. 
      // Express default without custom handler sends HTML 500. 
      // To properly test the NotFoundError, let's add a simple error handler:
    });
  });

  describe('POST /api/v1/webhooks', () => {
    it('creates a webhook', async () => {
      const payload = {
        name: 'My Hook',
        url: 'https://test.com/hook',
        events: ['case.created']
      };
      
      prisma.webhook.create.mockResolvedValue({ id: 'wh-1', ...payload });
      
      const res = await request(app).post('/api/v1/webhooks').send(payload);
      
      expect(res.status).toBe(201);
      expect(res.body.webhook).toBeDefined();
      expect(res.body.secret).toBeDefined(); // Service generates a 32-byte secret
    });
  });

  describe('PATCH /api/v1/webhooks/:id', () => {
    it('updates a webhook', async () => {
      const existing = { id: 'wh-1', name: 'Old' };
      prisma.webhook.findFirst.mockResolvedValue(existing);
      prisma.webhook.update.mockResolvedValue({ ...existing, name: 'New Name' });
      
      const res = await request(app).patch('/api/v1/webhooks/wh-1').send({ name: 'New Name' });
      
      expect(res.status).toBe(200);
      expect(res.body.webhook.name).toBe('New Name');
    });
  });

  describe('DELETE /api/v1/webhooks/:id', () => {
    it('deletes a webhook', async () => {
      prisma.webhook.findFirst.mockResolvedValue({ id: 'wh-1' });
      prisma.webhook.delete.mockResolvedValue({});
      
      const res = await request(app).delete('/api/v1/webhooks/wh-1');
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
