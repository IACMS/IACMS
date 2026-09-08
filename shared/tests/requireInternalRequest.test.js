import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requireInternalRequest } from '../middleware/requireInternalRequest.js';

function mockReq(path = '/cases', headers = {}) {
  return { path, headers };
}

function run(middleware, req) {
  return new Promise((resolve) => {
    const res = {};
    middleware(req, res, (err) => resolve({ err }));
  });
}

describe('requireInternalRequest', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.INTERNAL_SERVICE_TOKEN;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows /health without a token', async () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'secret';
    const middleware = requireInternalRequest();
    const { err } = await run(middleware, mockReq('/health'));
    expect(err).toBeUndefined();
  });

  it('allows requests in development when token is not configured', async () => {
    const middleware = requireInternalRequest();
    const { err } = await run(middleware, mockReq('/cases'));
    expect(err).toBeUndefined();
  });

  it('rejects direct access when token is configured but missing', async () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'secret';
    const middleware = requireInternalRequest();
    const { err } = await run(middleware, mockReq('/cases'));
    expect(err?.message).toMatch(/Direct service access/i);
  });

  it('allows requests with a valid internal token', async () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'secret';
    const middleware = requireInternalRequest();
    const { err } = await run(
      middleware,
      mockReq('/cases', { 'x-internal-service-token': 'secret' }),
    );
    expect(err).toBeUndefined();
  });

  it('fails closed in production when token is not configured', async () => {
    process.env.NODE_ENV = 'production';
    const middleware = requireInternalRequest();
    const { err } = await run(middleware, mockReq('/cases'));
    expect(err?.message).toMatch(/INTERNAL_SERVICE_TOKEN/i);
  });
});
