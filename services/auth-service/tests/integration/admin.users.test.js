/**
 * Integration tests — admin user management (Phase 4).
 *
 * Requires Docker: PostgreSQL on localhost:5433, Redis on localhost:6379.
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import Redis from 'ioredis';
import bcrypt from 'bcryptjs';
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
  SYSTEM_ADMIN_ROLE_ID,
  PLATFORM_TENANT_CODE,
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
const createdDepartmentIds = [];

let adminToken;
let adminUserId;
let testUserId;
let testDepartmentId;
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

  const tenant = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
  expect(tenant).toBeTruthy();
  const dept = await prisma.department.create({
    data: {
      tenantId: tenant.id,
      code: `IT-DEPT-${Date.now()}`,
      name: `Integration Department ${Date.now()}`,
      description: 'Department created for integration tests',
      isActive: true,
    },
  });
  testDepartmentId = dept.id;
  createdDepartmentIds.push(dept.id);

  // Create a reusable test user for management operations
  const createRes = await request(app)
    .post('/auth/users/create')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      email: testUserEmail,
      firstName: 'Managed',
      lastName: 'User',
      tenantCode: TENANT_CODE,
      departmentId: testDepartmentId,
    });

  expect(createRes.status).toBe(201);
  testUserId = createRes.body.user.id;
  expect(createRes.body.user.departmentId).toBe(testDepartmentId);
  createdUserEmails.push(testUserEmail);
});

afterAll(async () => {
  await cleanupUsers(prisma, createdUserEmails);
  if (createdDepartmentIds.length) {
    await prisma.department.deleteMany({ where: { id: { in: createdDepartmentIds } } });
  }
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
    const created = res.body.users.find((u) => u.id === testUserId);
    expect(created?.departmentId).toBe(testDepartmentId);
    expect(created?.department?.id).toBe(testDepartmentId);
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
  it('forbids tenant_admin from assigning system_admin', async () => {
    const tenant = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
    expect(tenant).toBeTruthy();

    const email = `no-sysadmin-${Date.now()}@test-org.com`;
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        username: `u_${Date.now()}`,
        passwordHash: hash,
        firstName: 'Role',
        lastName: 'Victim',
        isActive: true,
        mustChangePassword: false,
        isEmailVerified: true,
      },
    });
    createdUserEmails.push(email);

    const loginRes = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.accessToken;

    const res = await request(app)
      .patch(`/auth/users/${user.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleId: SYSTEM_ADMIN_ROLE_ID });

    expect(res.status).toBe(403);
  });

  it('allows system_admin to assign system_admin only to users in ADMIN tenant', async () => {
    let platformTenant = await prisma.tenant.findUnique({ where: { code: PLATFORM_TENANT_CODE } });
    if (!platformTenant) {
      platformTenant = await prisma.tenant.create({
        data: {
          code: PLATFORM_TENANT_CODE,
          name: 'IACMS Platform (integration test)',
          description: 'Bootstrap platform tenant for tests',
          isActive: true,
        },
      });
    }

    const sysEmail = `sysadmin-${Date.now()}@iacms-plat.example`;
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const sysUser = await prisma.user.create({
      data: {
        tenantId: platformTenant.id,
        email: sysEmail,
        username: `sys_${Date.now()}`,
        passwordHash: hash,
        firstName: 'Sys',
        lastName: 'Admin',
        isActive: true,
        mustChangePassword: false,
        isEmailVerified: true,
      },
    });
    await prisma.userRole.deleteMany({ where: { userId: sysUser.id } });
    await prisma.userRole.create({
      data: { userId: sysUser.id, roleId: SYSTEM_ADMIN_ROLE_ID, assignedBy: sysUser.id },
    });
    createdUserEmails.push(sysEmail);

    const loginSys = await request(app)
      .post('/auth/login')
      .send({ email: sysEmail, password: ADMIN_PASSWORD, tenantCode: PLATFORM_TENANT_CODE });

    expect(loginSys.status).toBe(200);
    const sysToken = loginSys.body.accessToken;

    const blockOps = await request(app)
      .patch(`/auth/users/${testUserId}/role`)
      .set('Authorization', `Bearer ${sysToken}`)
      .send({ roleId: SYSTEM_ADMIN_ROLE_ID });

    expect(blockOps.status).toBe(404);

    const peerEmail = `peer-platform-${Date.now()}@iacms-plat.example`;
    const createPeer = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${sysToken}`)
      .send({
        email: peerEmail,
        firstName: 'Peer',
        lastName: 'Platform',
        tenantCode: PLATFORM_TENANT_CODE,
      });

    expect(createPeer.status).toBe(201);
    createdUserEmails.push(peerEmail);
    const peerId = createPeer.body.user.id;

    const assignOk = await request(app)
      .patch(`/auth/users/${peerId}/role`)
      .set('Authorization', `Bearer ${sysToken}`)
      .send({ roleId: SYSTEM_ADMIN_ROLE_ID });

    expect(assignOk.status).toBe(200);
    const peerRole = await prisma.userRole.findFirst({ where: { userId: peerId } });
    expect(peerRole?.roleId).toBe(SYSTEM_ADMIN_ROLE_ID);
  });

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
