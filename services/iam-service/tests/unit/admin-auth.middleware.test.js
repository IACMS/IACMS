import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-secret-at-least-32-chars-long-123456';
process.env.JWT_SECRET = TEST_SECRET;

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn(() => mockRedis),
  closeRedisClient: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
    },
    oAuthClient: {
      findFirst: vi.fn(),
    },
    userApplicationRole: {
      findFirst: vi.fn(),
    },
    iamMembership: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from '../../src/config/database.js';
import { authenticateAdminRequest } from '../../src/middleware/admin-auth.middleware.js';

describe('admin-auth.middleware HMAC branch tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
  });

  function makeReq(token) {
    return {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
  }

  it('user in ADMIN tenant without role -> 403', async () => {
    const token = jwt.sign(
      { id: 'user-admin-tenant', tenantId: 'tenant-admin-id', roles: [] },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const req = makeReq(token);
    const res = {};
    const next = vi.fn();

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-admin-tenant',
      tenantId: 'tenant-admin-id',
      email: 'admin-tenant-user@example.com',
      isActive: true,
      mustChangePassword: false,
      tenant: { id: 'tenant-admin-id', code: 'ADMIN', isActive: true },
      userRoles: [], // NO admin role!
    });

    await authenticateAdminRequest(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });

  it('normal user -> 403', async () => {
    const token = jwt.sign(
      { id: 'user-normal', tenantId: 'tenant-normal-id', roles: [] },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const req = makeReq(token);
    const res = {};
    const next = vi.fn();

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-normal',
      tenantId: 'tenant-normal-id',
      email: 'normal@example.com',
      isActive: true,
      mustChangePassword: false,
      tenant: { id: 'tenant-normal-id', code: 'TENANT1', isActive: true },
      userRoles: [
        {
          role: { id: 'r-1', name: 'viewer', slug: 'viewer', isActive: true },
          expiresAt: null,
        },
      ],
    });

    await authenticateAdminRequest(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });

  it('revoked or blacklisted token -> 401', async () => {
    const jti = 'revoked-jti-123';
    const token = jwt.sign(
      { id: 'admin-user', tenantId: 'tenant-1', roles: ['system-admin'], jti },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const req = makeReq(token);
    const res = {};
    const next = vi.fn();

    mockRedis.get.mockImplementation(async (key) => {
      if (key === `auth:blacklist:${jti}`) return '1';
      return null;
    });

    await authenticateAdminRequest(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(401);
  });

  it('refresh token -> 401', async () => {
    // Refresh token contains { id, jti } without access token claims or with type: 'refresh'
    const token = jwt.sign(
      { id: 'admin-user', jti: 'refresh-jti-456', type: 'refresh' },
      TEST_SECRET,
      { expiresIn: '7d' },
    );
    const req = makeReq(token);
    const res = {};
    const next = vi.fn();

    await authenticateAdminRequest(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(401);
  });

  it('user with expired admin role -> 403', async () => {
    const token = jwt.sign(
      { id: 'admin-user', tenantId: 'tenant-1', roles: ['system-admin'], jti: 'valid-jti' },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const req = makeReq(token);
    const res = {};
    const next = vi.fn();

    prisma.user.findFirst.mockResolvedValue({
      id: 'admin-user',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      isActive: true,
      mustChangePassword: false,
      tenant: { id: 'tenant-1', code: 'TENANT1', isActive: true },
      userRoles: [
        {
          role: { id: 'r-admin', name: 'system_admin', slug: 'system-admin', isActive: true },
          expiresAt: new Date(Date.now() - 60000), // Expired 1 minute ago!
        },
      ],
    });

    await authenticateAdminRequest(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });

  it('user with mustChangePassword -> 403', async () => {
    const token = jwt.sign(
      { id: 'admin-user', tenantId: 'tenant-1', roles: ['system-admin'], mustChangePassword: true, jti: 'valid-jti' },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const req = makeReq(token);
    const res = {};
    const next = vi.fn();

    prisma.user.findFirst.mockResolvedValue({
      id: 'admin-user',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      isActive: true,
      mustChangePassword: true,
      tenant: { id: 'tenant-1', code: 'TENANT1', isActive: true },
      userRoles: [
        {
          role: { id: 'r-admin', name: 'system_admin', slug: 'system-admin', isActive: true },
          expiresAt: null,
        },
      ],
    });

    await authenticateAdminRequest(req, res, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });

  it('active admin gets only ["iam:admin"] permissions', async () => {
    const token = jwt.sign(
      { id: 'admin-user', tenantId: 'tenant-1', roles: ['system-admin'], mustChangePassword: false, jti: 'valid-jti' },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const req = makeReq(token);
    const res = {};
    const next = vi.fn();

    prisma.user.findFirst.mockResolvedValue({
      id: 'admin-user',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      isActive: true,
      mustChangePassword: false,
      tenant: { id: 'tenant-1', code: 'TENANT1', isActive: true },
      userRoles: [
        {
          role: { id: 'r-admin', name: 'system_admin', slug: 'system-admin', isActive: true },
          expiresAt: null,
        },
      ],
    });

    await authenticateAdminRequest(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.iamAdminAuthorized).toBe(true);
    expect(req.user.permissions).toEqual(['iam:admin']);
  });
});
