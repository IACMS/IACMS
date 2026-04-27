/**
 * Integration tests: express-session with Redis store (real Redis on REDIS_URL).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createClient } from 'redis';

const defaultRedis = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let redisUp = false;

async function pingRedis(url) {
  const c = createClient({ url });
  try {
    await c.connect();
    await c.ping();
    return true;
  } catch {
    return false;
  } finally {
    try {
      await c.quit();
    } catch {
      // ignore
    }
  }
}

beforeAll(async () => {
  redisUp = await pingRedis(defaultRedis);
});

afterAll(() => {
  process.env.REDIS_URL = defaultRedis;
});

describe('Redis session store', () => {
  it(
    'createSessionMiddleware fails fast when Redis is unreachable',
    async () => {
      vi.resetModules();
      process.env.REDIS_URL = 'redis://127.0.0.1:63979';
      process.env.REDIS_CONNECT_TIMEOUT_MS = '2000';
      const { createSessionMiddleware, closeSessionStore } = await import(
        '../src/config/session.config.js'
      );
      await expect(createSessionMiddleware()).rejects.toThrow(
        /cannot connect to Redis|Session store|timeout/i
      );
      await closeSessionStore();
      process.env.REDIS_URL = defaultRedis;
      delete process.env.REDIS_CONNECT_TIMEOUT_MS;
    },
    10_000
  );

  it('persists session in Redis under iacms:sess: and round-trips via cookie', async () => {
    if (!redisUp) {
      console.warn('[api-gateway tests] Skipping session round-trip: Redis not available at', defaultRedis);
      return;
    }

    vi.resetModules();
    process.env.REDIS_URL = defaultRedis;
    process.env.SESSION_SECRET = 'test-secret-for-vitest';

    const { createSessionMiddleware, closeSessionStore, SESSION_REDIS_KEY_PREFIX } =
      await import('../src/config/session.config.js');

    expect(SESSION_REDIS_KEY_PREFIX).toBe('iacms:sess:');

    const middleware = await createSessionMiddleware();
    const app = express();
    app.use(cookieParser());
    app.use(middleware);
    app.get('/set', (req, res) => {
      req.session.ping = 'pong-12345';
      req.session.save((err) => (err ? res.status(500).end() : res.json({ ok: true })));
    });
    app.get('/get', (req, res) => {
      res.json({ ping: req.session.ping || null });
    });

    const agent = request.agent(app);
    await agent.get('/set').expect(200, { ok: true });
    const res2 = await agent.get('/get');
    expect(res2.body.ping).toBe('pong-12345');

    const r = createClient({ url: defaultRedis });
    await r.connect();
    const keys = await r.keys(`${SESSION_REDIS_KEY_PREFIX}*`);
    expect(keys.length).toBeGreaterThan(0);
    await r.quit();

    await closeSessionStore();
  });
});
