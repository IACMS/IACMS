/**
 * Integration tests — CaseReferral + Case models.
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

describe.skipIf(() => !dbReady)('CaseReferral model integration', () => {
  it('GET /referrals returns cross-tenant referrals for DCS-01', async () => {
    const res = await request(app).get('/referrals').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.referrals.length).toBeGreaterThanOrEqual(3);
    const statuses = new Set(res.body.referrals.map((r) => r.status));
    expect(statuses.has('accepted') || statuses.has('completed') || statuses.has('rejected')).toBe(true);
  });

  it('GET /referrals/:id includes related Case', async () => {
    const list = await request(app).get('/referrals').set(headers);
    const id = list.body.referrals[0].id;
    const res = await request(app).get(`/referrals/${id}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.referral.case).toBeTruthy();
    expect(res.body.referral.case.id).toBeTruthy();
  });
});
