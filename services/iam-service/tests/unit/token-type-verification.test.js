import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret-minimum-32-chars-long-for-testing-only!';
process.env.JWT_SECRET = TEST_SECRET;

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
}));

import prisma from '../../src/config/database.js';

let generateTokens;
let JWT_SECRET;
let refreshToken;
let authenticateToken;

describe('Item 5: Access vs Refresh Token typing and verification', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const helpers = await import('../../src/utils/auth.helpers.js');
    generateTokens = helpers.generateTokens;
    JWT_SECRET = helpers.JWT_SECRET;
    const sessionCtrl = await import('../../src/controllers/auth/auth.session.controller.js');
    refreshToken = sessionCtrl.refreshToken;
    const authMw = await import('../../src/middleware/auth.middleware.js');
    authenticateToken = authMw.authenticateToken;
  });
  const dummyUser = {
    id: 'user-uuid-1',
    tenantId: 'tenant-uuid-1',
    email: 'user@example.com',
    mustChangePassword: false,
    isActive: true,
    tenant: { id: 'tenant-uuid-1', isActive: true },
    userRoles: [{ roleId: 'role-1' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(dummyUser);
    prisma.user.findFirst.mockResolvedValue({ mustChangePassword: false });
  });

  it('marks access tokens with type: access and refresh tokens with type: refresh in generateTokens', () => {
    const { accessToken, refreshToken: refToken } = generateTokens(dummyUser, ['role-1']);

    const decodedAccess = jwt.verify(accessToken, JWT_SECRET);
    const decodedRefresh = jwt.verify(refToken, JWT_SECRET);

    // Access token claims
    expect(decodedAccess.type).toBe('access');
    expect(decodedAccess.id).toBe(dummyUser.id);
    expect(decodedAccess.tenantId).toBe(dummyUser.tenantId);
    expect(decodedAccess.roles).toEqual(['role-1']);
    expect(decodedAccess.jti).toBeDefined();

    // Refresh token claims
    expect(decodedRefresh.type).toBe('refresh');
    expect(decodedRefresh.id).toBe(dummyUser.id);
    expect(decodedRefresh.jti).toBeDefined();
    expect(decodedRefresh.tenantId).toBeUndefined();
    expect(decodedRefresh.roles).toBeUndefined();
  });

  it('refreshToken endpoint rejects access token sent as refresh token', async () => {
    const { accessToken } = generateTokens(dummyUser, ['role-1']);

    const req = { body: { refreshToken: accessToken } };
    const res = { json: vi.fn() };
    const next = vi.fn();

    await refreshToken(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      name: 'UnauthorizedError',
      message: 'Invalid token type',
    }));
  });

  it('authenticateToken middleware accepts valid access token', async () => {
    const { accessToken } = generateTokens(dummyUser, ['role-1']);

    const req = { headers: { authorization: `Bearer ${accessToken}` } };
    const res = {};
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
    expect(req.user.type).toBe('access');
  });

  it('authenticateToken middleware rejects refresh token sent as Bearer token', async () => {
    const { refreshToken: refToken } = generateTokens(dummyUser, ['role-1']);

    const req = { headers: { authorization: `Bearer ${refToken}` } };
    const res = {};
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      name: 'UnauthorizedError',
      message: 'Invalid token type',
    }));
  });
});
