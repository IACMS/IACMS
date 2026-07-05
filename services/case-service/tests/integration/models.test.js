/**
 * Integration tests — Case, CaseHistory, CaseSequence models.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { canConnect, loadSeedUser } from '../../../../shared/tests/db.js';
import { TENANT_CODES } from '../../../../shared/tests/seed-constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

const prisma = new PrismaClient();
let app;
let dbReady = false;
let headers = {};

beforeAll(async () => {
  dbReady = await canConnect(prisma);
  if (!dbReady) return;
  const seed = await loadSeedUser(prisma, TENANT_CODES.DCS01, 'admin');
  if (!seed) throw new Error('Seed data missing');
  headers = {
    'x-tenant-id': seed.tenant.id,
    'x-user-id': seed.user.id,
  };
  ({ default: app } = await import('../../src/server.js'));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(() => !dbReady)('Case model integration', () => {
  it('GET /cases returns seeded cases for tenant admin', async () => {
    const res = await request(app).get('/cases').set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.cases)).toBe(true);
    expect(res.body.cases.length).toBeGreaterThan(0);
    expect(res.body.cases[0]).toHaveProperty('caseNumber');
  });

  it('GET /cases/:id/history returns CaseHistory rows', async () => {
    const list = await request(app).get('/cases').set(headers);
    const caseId = list.body.cases[0].id;
    const res = await request(app).get(`/cases/${caseId}/history`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.history)).toBe(true);
  });
});

describe.skipIf(() => !dbReady)('CaseSequence model integration', () => {
  it('case numbers follow tenant-year-sequence pattern', async () => {
    const res = await request(app).get('/cases').set(headers);
    const num = res.body.cases[0].caseNumber;
    expect(num).toMatch(/^DCS01-\d{4}-\d+$/);
  });
});

describe.skipIf(() => !dbReady)('Assignment model integration', () => {
  it('GET /assignments returns active assignments for tenant', async () => {
    const res = await request(app).get('/assignments').set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.assignments)).toBe(true);
  });
});

describe.skipIf(() => !dbReady)('CaseAttachment model integration', () => {
  it('GET /attachments/:caseId returns attachment list', async () => {
    const list = await request(app).get('/cases').set(headers);
    const caseId = list.body.cases[0].id;
    const res = await request(app).get(`/attachments/${caseId}`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.attachments)).toBe(true);
  });
});
