import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../../src/config/index.js', () => ({
  default: { auth: { jwtSecret: 'test-secret' } },
}));

vi.mock('../../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

const prisma = (await import('../../../src/config/database.js')).default;
const { authenticateToken } = await import('../../../src/api/middleware/auth.middleware.js');

const originalToken = process.env.INTERNAL_SERVICE_TOKEN;

function mockReq(headers = {}) {
  return { headers };
}

function run(req) {
  return new Promise((resolve) => {
    const res = {};
    authenticateToken(req, res, (err) => resolve({ err, user: req.user }));
  });
}

describe('authenticateToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_SERVICE_TOKEN = 'gateway-secret';
  });

  afterEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  it('trusts gateway headers without DB when internal token is valid', async () => {
    const { err, user } = await run(
      mockReq({
        'x-internal-service-token': 'gateway-secret',
        'x-user-id': 'u1',
        'x-tenant-id': 't1',
        'x-user-email': 'a@b.c',
        'x-user-roles': 'role-uuid',
        'x-user-permissions': 'file:upload,file:read,cases:read',
      }),
    );
    expect(err).toBeUndefined();
    expect(user.permissions).toEqual(['file:upload', 'file:read', 'cases:read']);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('verifies gateway headers in DB when internal token is absent (dev direct access)', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      departmentId: null,
      email: 'a@b.c',
      mustChangePassword: false,
      userRoles: [{ roleId: 'role-uuid' }],
    });

    const { err, user } = await run(
      mockReq({
        'x-user-id': 'u1',
        'x-tenant-id': 't1',
        'x-user-permissions': 'file:upload,file:read,cases:read',
      }),
    );
    expect(err).toBeUndefined();
    expect(user.permissions).toEqual(['file:upload', 'file:read', 'cases:read']);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it('rejects spoofed gateway headers when DB verification fails', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    prisma.user.findFirst.mockResolvedValue(null);

    const { err } = await run(mockReq({ 'x-user-id': 'u1', 'x-tenant-id': 'wrong-tenant' }));
    expect(err?.message).toMatch(/Invalid forwarded identity/i);
  });

  it('falls back to JWT when gateway headers are absent', async () => {
    const token = jwt.sign(
      { id: 'u2', tenantId: 't2', roles: ['r1'], permissions: ['file:admin'] },
      'test-secret',
    );
    const { err, user } = await run(mockReq({ authorization: `Bearer ${token}` }));
    expect(err).toBeUndefined();
    expect(user.id).toBe('u2');
    expect(user.permissions).toEqual(['file:admin']);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
