/**
 * Integration tests — Phase 5 self-service endpoints.
 *
 * Covers:
 *   PATCH /auth/profile      — update own firstName/lastName/phone
 *   POST  /auth/verify-email — public token verification
 *   POST  /auth/resend-verification — re-send verification email
 *
 * Requires Docker: PostgreSQL on localhost:5433, Redis on localhost:6379.
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { PrismaClient } from '../../src/generated/prisma/client.js';
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
  makeLoginHelper,
  resetAdminPassword,
  clearRedisLockout,
  cleanupUsers,
} from '../helpers/setup.js';

const prisma  = new PrismaClient();
const redis   = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const loginAs = makeLoginHelper(app, request);

let adminToken;
const createdEmails = [];

beforeAll(async () => {
  try { await prisma.$connect(); } catch {
    throw new Error('Cannot connect to PostgreSQL. Start Docker first.');
  }
  try { await redis.ping(); } catch {
    throw new Error('Cannot connect to Redis. Start Docker first.');
  }
  await resetAdminPassword(prisma);
  await clearRedisLockout(redis, ADMIN_EMAIL);

  const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  adminToken = res.body.accessToken;
});

afterAll(async () => {
  await cleanupUsers(prisma, createdEmails);
  await prisma.$disconnect();
  await redis.quit();
});

// ── PATCH /auth/profile ───────────────────────────────────────────────────────
describe('PATCH /auth/profile', () => {
  it('updates firstName and lastName', async () => {
    const res = await request(app)
      .patch('/auth/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Updated', lastName: 'Name' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Updated');
    expect(res.body.user.lastName).toBe('Name');

    // restore
    await request(app)
      .patch('/auth/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Admin', lastName: 'User' });
  });

  it('returns 400 when no fields provided', async () => {
    const res = await request(app)
      .patch('/auth/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/at least one field/i);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).patch('/auth/profile').send({ firstName: 'X' });
    expect(res.status).toBe(401);
  });
});

// ── POST /auth/verify-email ───────────────────────────────────────────────────
describe('POST /auth/verify-email', () => {
  it('marks isEmailVerified=true with a valid token', async () => {
    // Create a test user so we have a real email verification token
    const email = `verify-test-${Date.now()}@test-org.com`;
    createdEmails.push(email);

    await request(app)
      .post('/auth/register')
      .send({ email, password: 'Test1234', firstName: 'Verify', lastName: 'Test', tenantCode: TENANT_CODE });

    // Retrieve the raw token from DB by looking up the hash
    const user = await prisma.user.findFirst({ where: { email } });
    expect(user).not.toBeNull();
    expect(user.emailVerificationToken).not.toBeNull();

    // We don't have the raw token directly — but we can set a known one
    const rawToken = 'test-verification-token-12345';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires   = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: tokenHash, emailVerificationExpires: expires },
    });

    const res = await request(app)
      .post('/auth/verify-email')
      .send({ token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);

    const updated = await prisma.user.findFirst({ where: { email } });
    expect(updated.isEmailVerified).toBe(true);
    expect(updated.emailVerificationToken).toBeNull();
  });

  it('returns 400 for an invalid token', async () => {
    const res = await request(app)
      .post('/auth/verify-email')
      .send({ token: 'completely-wrong-token' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('returns 400 when no token provided', async () => {
    const res = await request(app).post('/auth/verify-email').send({});
    expect(res.status).toBe(400);
  });
});

// ── POST /auth/resend-verification ───────────────────────────────────────────
describe('POST /auth/resend-verification', () => {
  it('generates a new token for an unverified user', async () => {
    // Create a test user
    const email = `resend-test-${Date.now()}@test-org.com`;
    createdEmails.push(email);

    const regRes = await request(app)
      .post('/auth/register')
      .send({ email, password: 'Test1234', firstName: 'Resend', lastName: 'Test', tenantCode: TENANT_CODE });

    const token = regRes.body.accessToken;

    const before = await prisma.user.findFirst({ where: { email } });
    const oldHash = before.emailVerificationToken;

    // Short delay so expires timestamp differs
    await new Promise(r => setTimeout(r, 10));

    const res = await request(app)
      .post('/auth/resend-verification')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/resent/i);

    const after = await prisma.user.findFirst({ where: { email } });
    expect(after.emailVerificationToken).not.toBeNull();
    expect(after.emailVerificationToken).not.toBe(oldHash);
  });

  it('returns 400 if email is already verified', async () => {
    // Mark admin as verified first
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { isEmailVerified: true },
    });

    const res = await request(app)
      .post('/auth/resend-verification')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already verified/i);

    // restore
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { isEmailVerified: false },
    });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/auth/resend-verification');
    expect(res.status).toBe(401);
  });
});
