/**
 * Integration tests — registration, admin user creation, and mustChangePassword enforcement.
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

beforeAll(async () => {
  try { await prisma.$connect(); } catch {
    throw new Error('Cannot connect to PostgreSQL. Start Docker first.');
  }
  try { await redis.ping(); } catch {
    throw new Error('Cannot connect to Redis. Start Docker first.');
  }
  await resetAdminPassword(prisma);
  await clearRedisLockout(redis, ADMIN_EMAIL);
});

afterAll(async () => {
  await cleanupUsers(prisma, createdUserEmails);
  await prisma.$disconnect();
  await redis.quit();
});

// ── mustChangePassword enforcement ───────────────────────────────────────────
describe('mustChangePassword enforcement', () => {
  let testUserEmail;
  let tempPassword;
  let testUserToken;

  beforeAll(async () => {
    const { body: { accessToken: adminToken } } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    testUserEmail = `mustchange-test-${Date.now()}@test-org.com`;
    createdUserEmails.push(testUserEmail);

    const createRes = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: testUserEmail, firstName: 'Must', lastName: 'Change', tenantCode: TENANT_CODE });

    expect(createRes.status).toBe(201);
    expect(createRes.body.user.mustChangePassword).toBe(true);

    // Override with known password for testing (temp password was sent via email)
    tempPassword = 'TempPass1!';
    await prisma.user.updateMany({
      where: { email: testUserEmail },
      data: { passwordHash: await bcrypt.hash(tempPassword, 10), mustChangePassword: true },
    });

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

  it('allows first-login change-password without current password when mustChangePassword', async () => {
    const { body: { accessToken: adminToken } } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const email = `forced-pw-${Date.now()}@test-org.com`;
    createdUserEmails.push(email);
    const tempPassword = 'TempPass123!';

    const createRes = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        firstName: 'Forced',
        lastName: 'Change',
        tenantCode: TENANT_CODE,
      });
    expect(createRes.status).toBe(201);

    await prisma.user.updateMany({
      where: { email },
      data: { passwordHash: await bcrypt.hash(tempPassword, 10), mustChangePassword: true },
    });

    const loginRes = await loginAs(email, tempPassword);
    expect(loginRes.body.user.mustChangePassword).toBe(true);

    const changeRes = await request(app)
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ newPassword: 'NewPass456!' });

    expect(changeRes.status).toBe(200);
  });

  it('new token after password change has mustChangePassword: false', async () => {
    await request(app)
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${testUserToken}`)
      .send({ currentPassword: tempPassword, newPassword: 'NewPass123!' });

    const loginRes = await loginAs(testUserEmail, 'NewPass123!');
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.mustChangePassword).toBe(false);

    const profileRes = await request(app)
      .get('/auth/profile')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

    expect(profileRes.status).toBe(200);
    expect(profileRes.body.user.email).toBe(testUserEmail);
  });
});

// ── Self-service registration ─────────────────────────────────────────────────
describe('POST /auth/register', () => {
  it('returns mustChangePassword true for new users', async () => {
    const email = `self-reg-${Date.now()}@test-org.com`;
    createdUserEmails.push(email);

    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'Test1234', firstName: 'New', lastName: 'User', tenantCode: TENANT_CODE });

    expect(res.status).toBe(201);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect(res.body.user.firstName).toBe('New');
    expect(res.body.user.lastName).toBe('User');
  });

  it('returns 400 when first name is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: `noname-${Date.now()}@test-org.com`, password: 'Test1234', lastName: 'Only', tenantCode: TENANT_CODE });

    expect(res.status).toBe(400);
  });
});

// ── createUser role assignment ────────────────────────────────────────────────
describe('createUser role assignment', () => {
  let adminToken;

  beforeAll(async () => {
    await clearRedisLockout(redis, ADMIN_EMAIL);
    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    adminToken = res.body.accessToken;
  });

  it('assigns role when valid roleId provided, response includes role', async () => {
    const email = `role-test-${Date.now()}@test-org.com`;
    createdUserEmails.push(email);

    const res = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, firstName: 'Role', lastName: 'Test', tenantCode: TENANT_CODE, roleId: ADMIN_ROLE_ID });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toMatchObject({ id: ADMIN_ROLE_ID, name: 'tenant_admin' });

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
      .send({ email, firstName: 'No', lastName: 'Role', tenantCode: TENANT_CODE });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBeNull();
  });

  it('returns 404 when roleId does not exist in DB', async () => {
    const email = `badrole-test-${Date.now()}@test-org.com`;
    createdUserEmails.push(email);

    const res = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, firstName: 'Bad', lastName: 'Role', tenantCode: TENANT_CODE, roleId: NONEXISTENT_UUID });

    expect(res.status).toBe(404);
  });

  it('returns 400 when roleId is not a valid UUID', async () => {
    const res = await request(app)
      .post('/auth/users/create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'malformed-role@test-org.com', firstName: 'Bad', lastName: 'UUID', tenantCode: TENANT_CODE, roleId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .post('/auth/users/create')
      .send({ email: 'noauth@test-org.com', firstName: 'No', lastName: 'Auth', tenantCode: TENANT_CODE });

    expect(res.status).toBe(401);
  });
});
