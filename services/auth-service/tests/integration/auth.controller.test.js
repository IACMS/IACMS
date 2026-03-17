/**
 * Integration tests for auth controller.
 *
 * Requires Docker to be running:
 *   - PostgreSQL on localhost:5433
 *   - Redis on localhost:6379
 *
 * Uses the seeded test data:
 *   - Tenant:  TEST-ORG
 *   - Admin:   admin@test-org.com / password123
 *   - Roles:   admin (55555555-...), case_manager, viewer
 *
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import bcrypt from 'bcryptjs';

// Import app after env is loaded
const { default: app } = await import('../../src/server.js');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// ── Seeded constants ──────────────────────────────────────────────────────────
const ADMIN_EMAIL = 'admin@test-org.com';
const ADMIN_PASSWORD = 'password123';
const TENANT_CODE = 'TEST-ORG';
const ADMIN_ROLE_ID = '55555555-5555-5555-5555-555555555555';
const NONEXISTENT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Track created test users for cleanup
const createdUserEmails = [];

async function loginAs(email, password) {
  const res = await request(app)
    .post('/auth/login')
    .send({ email, password, tenantCode: TENANT_CODE });
  return res;
}

async function cleanupTestUsers() {
  if (createdUserEmails.length === 0) return;
  await prisma.user.deleteMany({
    where: { email: { in: createdUserEmails } },
  });
  createdUserEmails.length = 0;
}

async function clearRedisLockout(email) {
  await redis.del(`auth:lockout:${email}`, `auth:attempts:${email}`);
}

beforeAll(async () => {
  // Ensure DB and Redis are reachable — if not, fail fast with a clear message
  try {
    await prisma.$connect();
  } catch {
    throw new Error(
      'Cannot connect to PostgreSQL at localhost:5433. Start Docker first:\n' +
      '  cd infrastructure && docker-compose up -d postgres redis'
    );
  }

  try {
    await redis.ping();
  } catch {
    throw new Error(
      'Cannot connect to Redis at localhost:6379. Start Docker first:\n' +
      '  cd infrastructure && docker-compose up -d postgres redis'
    );
  }

  // Reset admin password to known value so tests are independent of prior runs
  const freshHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.user.updateMany({
    where: { email: ADMIN_EMAIL },
    data: { passwordHash: freshHash, mustChangePassword: false },
  });

  // Clear any leftover Redis lockout keys from prior runs
  await redis.del(
    `auth:lockout:${ADMIN_EMAIL}`,
    `auth:attempts:${ADMIN_EMAIL}`
  );
});

afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await redis.quit();
});

// ── Login + lockout (Phase 2.3) ───────────────────────────────────────────────
describe('Login', () => {
  it('returns 200 with accessToken and mustChangePassword on successful login', async () => {
    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.mustChangePassword).toBe(false);
    expect(res.body.user.email).toBe(ADMIN_EMAIL);
  });

  it('returns 401 for wrong password', async () => {
    await clearRedisLockout(ADMIN_EMAIL);

    const res = await loginAs(ADMIN_EMAIL, 'wrong-password');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid credentials/i);
  });

  it('locks account after 5 consecutive wrong passwords', async () => {
    await clearRedisLockout(ADMIN_EMAIL);

    for (let i = 0; i < 5; i++) {
      await loginAs(ADMIN_EMAIL, 'bad-pass');
    }

    // 6th attempt — even with correct password — should be locked
    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/account temporarily locked/i);

    // Clear lockout so subsequent test suites are not affected
    await clearRedisLockout(ADMIN_EMAIL);
  }, 20000);

  it('allows login again after lockout is manually cleared', async () => {
    await clearRedisLockout(ADMIN_EMAIL);

    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });
});

// ── Logout + blacklist (Phase 2.2) ────────────────────────────────────────────
describe('Logout and token blacklist', () => {
  it('returns 200 on logout', async () => {
    const loginRes = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = loginRes.body.accessToken;

    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });

  it('rejects the same token after logout with 401', async () => {
    const loginRes = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = loginRes.body.accessToken;

    // Logout
    await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    // Try using the revoked token
    const res = await request(app)
      .get('/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/revoked/i);
  });

  it('returns 401 when trying to logout without a token', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(401);
  });
});

// ── mustChangePassword enforcement (Phase 1.2) ───────────────────────────────
describe('mustChangePassword enforcement', () => {
  let testUserEmail;
  let tempPassword;
  let testUserToken;

  beforeAll(async () => {
    // Create a test user as admin (will have mustChangePassword: true)
    const adminLogin = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const adminToken = adminLogin.body.accessToken;

    testUserEmail = `mustchange-test-${Date.now()}@test-org.com`;
    createdUserEmails.push(testUserEmail);

    const createRes = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: testUserEmail,
        firstName: 'Must',
        lastName: 'Change',
        tenantCode: TENANT_CODE,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.user.mustChangePassword).toBe(true);

    // Reset to a known password so we can log in (temp password was emailed, unknown here)
    const newPassword = 'TempPass1!';
    await prisma.user.updateMany({
      where: { email: testUserEmail },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        mustChangePassword: true,
      },
    });
    tempPassword = newPassword;

    const loginRes = await loginAs(testUserEmail, tempPassword);
    testUserToken = loginRes.body.accessToken;
  });

  it('login response includes mustChangePassword: true for admin-created user', async () => {
    const res = await loginAs(testUserEmail, tempPassword);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('blocks GET /auth/profile with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const res = await request(app)
      .get('/auth/profile')
      .set('Authorization', `Bearer ${testUserToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('blocks POST /auth/logout with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${testUserToken}`);

    expect(res.status).toBe(403);
  });

  it('allows POST /auth/change-password (not blocked)', async () => {
    const res = await request(app)
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send({ currentPassword: tempPassword, newPassword: 'NewPass123!' });

    expect(res.status).toBe(200);
  });

  it('new token after change has mustChangePassword: false', async () => {
    // Change password first
    await request(app)
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send({ currentPassword: tempPassword, newPassword: 'NewPass123!' });

    // Login with new password
    const loginRes = await loginAs(testUserEmail, 'NewPass123!');
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.mustChangePassword).toBe(false);

    // Profile should now work
    const profileRes = await request(app)
      .get('/auth/profile')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

    expect(profileRes.status).toBe(200);
    expect(profileRes.body.user.email).toBe(testUserEmail);
  });
});

// ── createUser role assignment (Phase 1.1) ────────────────────────────────────
describe('createUser role assignment', () => {
  let adminToken;

  beforeAll(async () => {
    await clearRedisLockout(ADMIN_EMAIL);
    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(res.status).toBe(200); // fail fast with clear message if login fails
    adminToken = res.body.accessToken;
  });

  it('assigns role when valid roleId is provided, response includes role', async () => {
    const email = `role-test-${Date.now()}@test-org.com`;
    createdUserEmails.push(email);

    const res = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        firstName: 'Role',
        lastName: 'Test',
        tenantCode: TENANT_CODE,
        roleId: ADMIN_ROLE_ID,
      });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toMatchObject({ id: ADMIN_ROLE_ID, name: 'admin' });

    // Verify in DB
    const user = await prisma.user.findFirst({ where: { email } });
    const userRole = await prisma.userRole.findFirst({ where: { userId: user.id } });
    expect(userRole).not.toBeNull();
    expect(userRole.roleId).toBe(ADMIN_ROLE_ID);
  });

  it('creates user with role: null when roleId is not provided', async () => {
    const email = `norole-test-${Date.now()}@test-org.com`;
    createdUserEmails.push(email);

    const res = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        firstName: 'No',
        lastName: 'Role',
        tenantCode: TENANT_CODE,
      });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBeNull();
  });

  it('returns 404 when roleId does not exist in DB', async () => {
    const email = `badrole-test-${Date.now()}@test-org.com`;
    createdUserEmails.push(email);

    const res = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        firstName: 'Bad',
        lastName: 'Role',
        tenantCode: TENANT_CODE,
        roleId: NONEXISTENT_UUID,
      });

    expect(res.status).toBe(404);
  });

  it('returns 400 when roleId is not a valid UUID', async () => {
    const res = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'malformed-role@test-org.com',
        firstName: 'Bad',
        lastName: 'UUID',
        tenantCode: TENANT_CODE,
        roleId: 'not-a-uuid',
      });

    expect(res.status).toBe(400);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .post('/auth/users/create')
      .send({
        email: 'noauth@test-org.com',
        firstName: 'No',
        lastName: 'Auth',
        tenantCode: TENANT_CODE,
      });

    expect(res.status).toBe(401);
  });
});
