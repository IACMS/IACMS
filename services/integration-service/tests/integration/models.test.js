/**
 * Integration tests — Webhook + Integration models.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import dotenv from 'dotenv';
import { canConnect, loadSeedUser } from '../../../../shared/tests/db.js';
import { TENANT_CODES } from '../../../../shared/tests/seed-constants.js';

dotenv.config();

const prisma = new PrismaClient();
let app;
let dbReady = false;
let tenantId;
let userId;
let createdWebhookId;
let createdIntegrationId;

beforeAll(async () => {
  dbReady = await canConnect(prisma);
  if (!dbReady) return;
  const seed = await loadSeedUser(prisma, TENANT_CODES.DCS01, 'admin');
  if (!seed) throw new Error('Seed data missing');
  tenantId = seed.tenant.id;
  userId = seed.user.id;
  ({ default: app } = await import('../../src/server.js'));
});

afterAll(async () => {
  if (createdWebhookId) {
    await prisma.webhook.delete({ where: { id: createdWebhookId } }).catch(() => {});
  }
  if (createdIntegrationId) {
    await prisma.integration.delete({ where: { id: createdIntegrationId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe.skipIf(() => !dbReady)('Webhook model integration', () => {
  it('POST /webhooks creates webhook', async () => {
    const res = await request(app)
      .post('/webhooks')
      .send({
        tenantId,
        name: 'Test Hook',
        url: 'https://example.com/hook',
        events: ['case.created'],
        createdBy: userId,
      });
    expect(res.status).toBe(201);
    createdWebhookId = res.body.webhook.id;
    expect(res.body.webhook.tenantId).toBe(tenantId);
  });

  it('GET /webhooks lists tenant webhooks', async () => {
    const res = await request(app).get('/webhooks').query({ tenantId });
    expect(res.status).toBe(200);
    expect(res.body.webhooks.some((w) => w.id === createdWebhookId)).toBe(true);
  });
});

describe.skipIf(() => !dbReady)('Integration model integration', () => {
  it('POST /integrations creates integration without exposing secrets', async () => {
    const res = await request(app)
      .post('/integrations')
      .send({
        tenantId,
        name: 'Test CRM',
        type: 'custom',
        config: { baseUrl: 'https://api.example.com' },
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        createdBy: userId,
      });
    expect(res.status).toBe(201);
    createdIntegrationId = res.body.integration.id;
    expect(res.body.integration.apiKey).toBeUndefined();
    expect(res.body.integration.apiSecret).toBeUndefined();
  });
});
