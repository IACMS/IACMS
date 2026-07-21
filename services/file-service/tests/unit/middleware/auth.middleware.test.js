import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../../src/config/index.js', () => ({
  default: { auth: { jwtSecret: 'test-secret' } },
}));

const { authenticateToken } = await import('../../../src/api/middleware/auth.middleware.js');

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
  });

  it('prefers gateway headers over Bearer JWT so RBAC permissions apply', async () => {
    const token = jwt.sign(
      { id: 'u1', tenantId: 't1', roles: ['role-uuid'], email: 'a@b.c' },
      'test-secret',
    );
    const { err, user } = await run(
      mockReq({
        authorization: `Bearer ${token}`,
        'x-user-id': 'u1',
        'x-tenant-id': 't1',
        'x-user-email': 'a@b.c',
        'x-user-roles': 'role-uuid',
        'x-user-permissions': 'file:upload,file:read,cases:read',
      }),
    );
    expect(err).toBeUndefined();
    expect(user.permissions).toEqual(['file:upload', 'file:read', 'cases:read']);
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
  });
});
