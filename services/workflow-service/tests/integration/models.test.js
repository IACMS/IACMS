/**
 * Integration tests — Workflow, WorkflowStep, WorkflowTransition models.
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
let headers = {};

beforeAll(async () => {
  dbReady = await canConnect(prisma);
  if (!dbReady) return;
  const seed = await loadSeedUser(prisma, TENANT_CODES.DCS01, 'admin');
  if (!seed) throw new Error('Seed data missing');
  headers = { 'x-tenant-id': seed.tenant.id, 'x-user-id': seed.user.id };
  ({ default: app } = await import('../../src/server.js'));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(() => !dbReady)('Workflow model integration', () => {
  it('GET /workflows lists tenant workflows', async () => {
    const res = await request(app).get('/workflows').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.workflows.length).toBeGreaterThanOrEqual(5);
  });

  it('GET /workflows/:id/full includes steps and transitions', async () => {
    const list = await request(app).get('/workflows').set(headers);
    const wfId = list.body.workflows[0].id;
    const res = await request(app).get(`/workflows/${wfId}/full`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workflow.steps)).toBe(true);
    expect(Array.isArray(res.body.workflow.transitions)).toBe(true);
    expect(res.body.workflow.steps.some((s) => s.isInitial)).toBe(true);
  });
});
