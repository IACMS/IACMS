/**
 * HTTP integration tests (real Prisma; DB must match workflow-service schema and seed-friendly).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const SEED_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FAKE_USER = '22222222-2222-2222-2222-222222222222';

let app;
beforeAll(async () => {
  const { default: a } = await import('../helpers/workflowTestApp.js');
  app = a;
});

describe('Workflow API', () => {
  it('POST /workflows rejects invalid definition (400)', async () => {
    const res = await request(app)
      .post('/workflows')
      .send({ tenantId: SEED_TENANT_ID, name: 't', definition: { states: [] } });
    expect(res.status).toBe(400);
  });

  it('POST /workflows/cases/:id/transition requires x-tenant-id (400)', async () => {
    const res = await request(app)
      .post(`/workflows/cases/${FAKE_ID}/transition`)
      .set('x-user-id', FAKE_USER)
      .send({ to: 'b' });
    expect(res.status).toBe(400);
  });

  it('POST /workflows/cases/:id/transition requires body.to (400)', async () => {
    const res = await request(app)
      .post(`/workflows/cases/${FAKE_ID}/transition`)
      .set('x-tenant-id', SEED_TENANT_ID)
      .set('x-user-id', FAKE_USER)
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST /workflows/cases/:id/transition returns 404 when case does not exist', async () => {
    const res = await request(app)
      .post(`/workflows/cases/${FAKE_ID}/transition`)
      .set('x-tenant-id', SEED_TENANT_ID)
      .set('x-user-id', FAKE_USER)
      .send({ to: 'b' });
    expect(res.status).toBe(404);
  });

  it('GET /workflows/:id/states returns list (empty for unknown id)', async () => {
    const res = await request(app).get(`/workflows/${FAKE_ID}/states`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.states)).toBe(true);
  });

  it('GET /workflows/:id returns 404 for unknown workflow', async () => {
    const res = await request(app).get(`/workflows/${FAKE_ID}`);
    expect(res.status).toBe(404);
  });
});
