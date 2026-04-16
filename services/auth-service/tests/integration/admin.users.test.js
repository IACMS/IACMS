/**
 * Integration tests — admin user management (Phase 4).
 *
 * Requires Docker: PostgreSQL on localhost:5433, Redis on localhost:6379.
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const { default: app } = await import('../../src/server.js');

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TENANT_CODE,
  ADMIN_ROLE_ID,
  NONEXISTENT_UUID,
  makeLoginHelper,
  resetAdminPassword,
  clearRedisLockout,
  cleanupUsers,
} from '../helpers/setup.js';

const prisma = new PrismaClient();
const redis  = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const loginAs = makeLoginHelper(app, request);
const createdUserEmails = [];

let adminToken;
let adminUserId;
let testUserId;
const testUserEmail = `mgmt-test-${Date.now()}@test-org.com`;

beforeAll(async () => {
  try { await prisma.$connect(); } catch {
    throw new Error('Cannot connect to PostgreSQL. Start Docker first.');
  }
  try { await redis.ping(); } catch {
    throw new Error('Cannot connect to Redis. Start Docker first.');
  }

  await resetAdminPassword(prisma);
  await clearRedisLockout(redis, ADMIN_EMAIL);

  const loginRes = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  expect(loginRes.status).toBe(200);
  adminToken  = loginRes.body.accessToken;
  adminUserId = loginRes.body.user.id;

  // Create a reusable test user for management operations
  const createRes = await request(app)
    .post('/auth/users/create')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: testUserEmail, firstName: 'Managed', lastName: 'User', tenantCode: TENANT_CODE });

  expect(createRes.status).toBe(201);
  testUserId = createRes.body.user.id;
  createdUserEmails.push(testUserEmail);
});

afterAll(async () => {
  await cleanupUsers(prisma, createdUserEmails);
  await prisma.$disconnect();
  await redis.quit();
});

// ── GET /auth/users ───────────────────────────────────────────────────────────
describe('GET /auth/users', () => {
  it('returns list of users scoped to admin tenant', async () => {
    const res = await request(app)
      .get('/auth/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/auth/users');
    expect(res.status).toBe(401);
  });
});

// ── GET /auth/users/:id ───────────────────────────────────────────────────────
describe('GET /auth/users/:id', () => {
  it('returns full user details', async () => {
    const res = await request(app)
      .get(`/auth/users/${testUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(testUserId);
    expect(res.body.user.email).toBe(testUserEmail);
    expect(res.body.user.tenant).toBeDefined();
  });

  it('returns 404 for user not in this tenant', async () => {
    const res = await request(app)
      .get(`/auth/users/${NONEXISTENT_UUID}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ── PATCH /auth/users/:id ─────────────────────────────────────────────────────
describe('PATCH /auth/users/:id', () => {
  it('updates user fields', async () => {
    const res = await request(app)
      .patch(`/auth/users/${testUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Updated', phone: '0901234567' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Updated');
    expect(res.body.user.phone).toBe('0901234567');
  });

  it('returns 400 when body has no valid fields', async () => {
    const res = await request(app)
      .patch(`/auth/users/${testUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown user', async () => {
    const res = await request(app)
      .patch(`/auth/users/${NONEXISTENT_UUID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ── PATCH /auth/users/:id/role ────────────────────────────────────────────────
describe('PATCH /auth/users/:id/role', () => {
  it('assigns role and verifies in DB', async () => {
    const res = await request(app)
      .patch(`/auth/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: ADMIN_ROLE_ID });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/assigned/i);

    const userRole = await prisma.userRole.findFirst({ where: { userId: testUserId } });
    expect(userRole).not.toBeNull();
    expect(userRole.roleId).toBe(ADMIN_ROLE_ID);
  });

  it('returns 400 when roleId is missing', async () => {
    const res = await request(app)
      .patch(`/auth/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── PATCH /auth/users/:id/deactivate ─────────────────────────────────────────
describe('PATCH /auth/users/:id/deactivate', () => {
  it('returns 400 when admin tries to deactivate themselves', async () => {
    const res = await request(app)
      .patch(`/auth/users/${adminUserId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/deactivate your own/i);
  });

  it('deactivates the test user', async () => {
    const res = await request(app)
      .patch(`/auth/users/${testUserId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deactivated/i);

    const user = await prisma.user.findFirst({ where: { id: testUserId } });
    expect(user.isActive).toBe(false);
  });
});

// ── PATCH /auth/users/:id/reactivate ─────────────────────────────────────────
describe('PATCH /auth/users/:id/reactivate', () => {
  it('reactivates the test user', async () => {
    const res = await request(app)
      .patch(`/auth/users/${testUserId}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reactivated/i);

    const user = await prisma.user.findFirst({ where: { id: testUserId } });
    expect(user.isActive).toBe(true);
  });
});

// ── DELETE /auth/users/:id ────────────────────────────────────────────────────
describe('DELETE /auth/users/:id', () => {
  it('returns 400 when admin tries to delete themselves', async () => {
    const res = await request(app)
      .delete(`/auth/users/${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/delete your own/i);
  });

  it('anonymizes PII and deactivates user', async () => {
    const res = await request(app)
      .delete(`/auth/users/${testUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    const user = await prisma.user.findFirst({ where: { id: testUserId } });
    expect(user.email).toBe(`deleted-${testUserId}@deleted.invalid`);
    expect(user.firstName).toBe('Deleted');
    expect(user.lastName).toBe('User');
    expect(user.isActive).toBe(false);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).delete(`/auth/users/${testUserId}`);
    expect(res.status).toBe(401);
  });
});
