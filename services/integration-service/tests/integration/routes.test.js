import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock database
vi.mock('../../src/config/database.js', () => {
  const prismaMock = {
    webhook: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    integration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback) => {
      return await callback(prismaMock);
    }),
  };
  return { default: prismaMock };
});

vi.mock('../../../../shared/utils/eventBus.js', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      publish: vi.fn(),
    })),
  };
});

import prisma from '../../src/config/database.js';
import webhookRoutes from '../../src/routes/webhook.routes.js';
import integrationRoutes from '../../src/routes/integration.routes.js';

const app = express();
app.use(express.json());

// Mock requireInternalRequest middleware
app.use((req, res, next) => {
  if (req.headers['authorization'] !== 'Bearer internal-test-token') {
    return res.status(401).json({ error: 'Unauthorized internal service request' });
  }
  next();
});

app.use('/webhooks', webhookRoutes);
app.use('/integrations', integrationRoutes);

describe('Integration Service Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Webhook Routes', () => {
    it('GET /webhooks returns list', async () => {
      prisma.webhook.findMany.mockResolvedValue([{ id: 'wh-1' }]);
      const response = await request(app)
        .get('/webhooks?tenantId=tenant-123')
        .set('Authorization', 'Bearer internal-test-token');
      expect(response.status).toBe(200);
      expect(response.body.webhooks).toHaveLength(1);
    });

    it('POST /webhooks creates a webhook', async () => {
      prisma.webhook.create.mockResolvedValue({ id: 'wh-2', url: 'http://test.com' });
      const response = await request(app)
        .post('/webhooks')
        .set('Authorization', 'Bearer internal-test-token')
        .send({ url: 'http://test.com' });
      expect(response.status).toBe(201);
      expect(response.body.webhook.id).toBe('wh-2');
    });

    it('GET /webhooks/:id/test publishes event', async () => {
      prisma.webhook.findUnique.mockResolvedValue({ id: 'wh-2', url: 'http://test.com' });
      const response = await request(app)
        .post('/webhooks/wh-2/test')
        .set('Authorization', 'Bearer internal-test-token');
      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Test webhook event published');
    });
  });

  describe('Integration Routes', () => {
    it('GET /integrations returns list', async () => {
      prisma.integration.findMany.mockResolvedValue([{ id: 'int-1' }]);
      const response = await request(app)
        .get('/integrations')
        .set('Authorization', 'Bearer internal-test-token');
      expect(response.status).toBe(200);
      expect(response.body.integrations).toHaveLength(1);
    });

    it('POST /integrations creates an integration', async () => {
      prisma.integration.create.mockResolvedValue({ id: 'int-2', type: 'slack' });
      const response = await request(app)
        .post('/integrations')
        .set('Authorization', 'Bearer internal-test-token')
        .send({ type: 'slack' });
      expect(response.status).toBe(201);
      expect(response.body.integration.id).toBe('int-2');
    });

    it('POST /integrations/:id/sync initiates sync', async () => {
      prisma.integration.findUnique.mockResolvedValue({ id: 'int-2', type: 'slack' });
      prisma.integration.update.mockResolvedValue({ id: 'int-2', type: 'slack', lastSyncAt: new Date() });
      const response = await request(app)
        .post('/integrations/int-2/sync')
        .set('Authorization', 'Bearer internal-test-token');
      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Sync initiated');
    });
  });
});
