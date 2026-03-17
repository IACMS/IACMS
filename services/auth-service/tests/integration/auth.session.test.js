/**
 * Integration tests — session management (login, logout, token blacklist).
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
  makeLoginHelper,
  resetAdminPassword,
  clearRedisLockout,
} from '../helpers/setup.js';

const prisma = new PrismaClient();
const redis  = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const loginAs = makeLoginHelper(app, request);

beforeAll(async () => {
  try { await prisma.$connect(); } catch {
    throw new Error('Cannot connect to PostgreSQL. Start Docker first: cd infrastructure && docker-compose up -d postgres redis');
  }
  try { await redis.ping(); } catch {
    throw new Error('Cannot connect to Redis. Start Docker first: cd infrastructure && docker-compose up -d postgres redis');
  }
  await resetAdminPassword(prisma);
  await clearRedisLockout(redis, ADMIN_EMAIL);
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

// ── Login + lockout ───────────────────────────────────────────────────────────
describe('Login', () => {
  it('returns 200 with accessToken and mustChangePassword on successful login', async () => {
    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.mustChangePassword).toBe(false);
    expect(res.body.user.email).toBe(ADMIN_EMAIL);
  });

  it('returns 401 for wrong password', async () => {
    await clearRedisLockout(redis, ADMIN_EMAIL);

    const res = await loginAs(ADMIN_EMAIL, 'wrong-password');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid credentials/i);
  });

  it('locks account after 5 consecutive wrong passwords', async () => {
    await clearRedisLockout(redis, ADMIN_EMAIL);

    for (let i = 0; i < 5; i++) {
      await loginAs(ADMIN_EMAIL, 'bad-pass');
    }

    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/account temporarily locked/i);

    await clearRedisLockout(redis, ADMIN_EMAIL);
  }, 20000);

  it('allows login again after lockout is manually cleared', async () => {
    await clearRedisLockout(redis, ADMIN_EMAIL);

    const res = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });
});

// ── Logout + token blacklist ──────────────────────────────────────────────────
describe('Logout and token blacklist', () => {
  it('returns 200 on logout', async () => {
    const { body: { accessToken } } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });

  it('rejects the same token after logout with 401', async () => {
    const { body: { accessToken } } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    await request(app).post('/auth/logout').set('Authorization', `Bearer ${accessToken}`);

    const res = await request(app)
      .get('/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/revoked/i);
  });

  it('returns 401 when trying to logout without a token', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(401);
  });
});
