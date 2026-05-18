/**
 * Unit tests for auth middleware.
 * Redis is mocked — no Docker required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'iacms-dev-secret-key-change-in-production';

// ── Mock Redis ────────────────────────────────────────────────────────────────
const mockRedis = {
  get: vi.fn(),
};

const { mockFindFirstUser } = vi.hoisted(() => ({
  mockFindFirstUser: vi.fn(),
}));

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn(() => mockRedis),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: mockFindFirstUser,
    },
  },
}));

// Import after mocks are set up
const { authenticateToken, authenticateTokenOptional, requirePasswordChange } = await import(
  '../../src/middleware/auth.middleware.js'
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function makeReq(token) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

// ── authenticateToken ─────────────────────────────────────────────────────────
describe('authenticateToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null); // not blacklisted by default
    mockFindFirstUser.mockReset();
    process.env.TRUST_GATEWAY_IDENTITY_HEADERS = 'false';
  });

  it('calls next with UnauthorizedError when no token provided', async () => {
    const req = makeReq(null);
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/token required/i);
    expect(mockFindFirstUser).not.toHaveBeenCalled();
  });

  it('accepts forwarded gateway identity when no Bearer token (trust on)', async () => {
    process.env.TRUST_GATEWAY_IDENTITY_HEADERS = 'true';
    mockFindFirstUser.mockResolvedValue({
      id: 'u-gateway',
      tenantId: 't1',
      email: 'a@b.gov',
      mustChangePassword: false,
      userRoles: [{ roleId: 'role-tenant-admin-uuid' }],
    });

    const req = {
      headers: { 'x-user-id': 'u-gateway', 'x-tenant-id': 't1' },
    };
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({
      id: 'u-gateway',
      tenantId: 't1',
      email: 'a@b.gov',
      roles: ['role-tenant-admin-uuid'],
      mustChangePassword: false,
    });
  });

  it('calls next with UnauthorizedError when forwarded tenant does not match user record', async () => {
    process.env.TRUST_GATEWAY_IDENTITY_HEADERS = 'true';
    mockFindFirstUser.mockResolvedValue({
      id: 'u-gateway',
      tenantId: 't-correct',
      email: 'a@b.gov',
      mustChangePassword: false,
      userRoles: [],
    });

    const req = {
      headers: { 'x-user-id': 'u-gateway', 'x-tenant-id': 't-wrong' },
    };
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/forwarded identity/i);
  });

  it('calls next with UnauthorizedError for an invalid JWT', async () => {
    const req = makeReq('this-is-not-a-valid-jwt');
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/invalid or expired/i);
  });

  it('calls next with UnauthorizedError for an expired JWT', async () => {
    const token = makeToken({ id: 'u1', jti: 'j1' }, '-1s'); // already expired
    const req = makeReq(token);
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('calls next with "revoked" error when token jti is in Redis blacklist', async () => {
    const jti = 'blacklisted-jti';
    const token = makeToken({ id: 'u1', jti });
    mockRedis.get.mockResolvedValue('1'); // blacklisted

    const req = makeReq(token);
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(mockRedis.get).toHaveBeenCalledWith(`auth:blacklist:${jti}`);
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/revoked/i);
  });

  it('sets req.user and calls next() for a valid non-blacklisted token', async () => {
    const payload = { id: 'u1', tenantId: 't1', email: 'a@b.com', jti: 'valid-jti', mustChangePassword: false };
    const token = makeToken(payload);
    mockRedis.get.mockResolvedValue(null); // not blacklisted
    mockFindFirstUser.mockResolvedValue({ mustChangePassword: false });

    const req = makeReq(token);
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(); // called with no args = success
    expect(req.user).toMatchObject({ id: 'u1', email: 'a@b.com', mustChangePassword: false });
  });

  it('overlay mustChangePassword from DB after password change (stale JWT still true)', async () => {
    const payload = { id: 'u1', tenantId: 't1', email: 'a@b.com', jti: 'jti-1', mustChangePassword: true };
    const token = makeToken(payload);
    mockRedis.get.mockResolvedValue(null);
    mockFindFirstUser.mockResolvedValue({ mustChangePassword: false });

    const req = makeReq(token);
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 'u1', mustChangePassword: false });
  });

  it('fails open (sets req.user, calls next) when Redis throws', async () => {
    const payload = { id: 'u1', jti: 'some-jti' };
    const token = makeToken(payload);
    mockRedis.get.mockRejectedValue(new Error('Redis connection refused'));
    mockFindFirstUser.mockResolvedValue({ mustChangePassword: false });

    const req = makeReq(token);
    const next = vi.fn();

    await authenticateToken(req, makeRes(), next);

    // Should not block the request when Redis is unavailable
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
  });
});

describe('authenticateTokenOptional', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
  });

  it('calls next() without setting req.user when Authorization is absent', async () => {
    const req = makeReq(null);
    const next = vi.fn();

    await authenticateTokenOptional(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
  });

  it('sets req.user when Bearer token is valid', async () => {
    const payload = {
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      jti: 'valid-jti',
      mustChangePassword: false,
    };
    const token = makeToken(payload);
    const req = makeReq(token);
    const next = vi.fn();

    await authenticateTokenOptional(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 'u1', tenantId: 't1' });
  });
});

// ── requirePasswordChange ─────────────────────────────────────────────────────
describe('requirePasswordChange', () => {
  it('returns 403 PASSWORD_CHANGE_REQUIRED when mustChangePassword is true', () => {
    const req = { user: { mustChangePassword: true } };
    const res = makeRes();
    const next = vi.fn();

    requirePasswordChange(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'PASSWORD_CHANGE_REQUIRED' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when mustChangePassword is false', () => {
    const req = { user: { mustChangePassword: false } };
    const next = vi.fn();

    requirePasswordChange(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when mustChangePassword is undefined', () => {
    const req = { user: {} };
    const next = vi.fn();

    requirePasswordChange(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
  });
});
