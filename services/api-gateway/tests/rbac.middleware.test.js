/**
 * RBAC middleware: /auth/users* routes and permission checks (IACMS RBAC DB mocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/redis.config.js', () => ({
  getRedisClient: () => null,
}));

const { userRoleFindMany, identityFindUnique } = vi.hoisted(() => ({
  userRoleFindMany: vi.fn(),
  identityFindUnique: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({
  default: {
    userRole: { findMany: userRoleFindMany },
    identityProjection: { findUnique: identityFindUnique },
  },
}));

import express from 'express';
import request from 'supertest';
import { createRbacMiddleware } from '../src/middleware/rbac.middleware.js';

function roleAssignments(permissions) {
  return [{
    role: {
      id: 'role-1',
      name: 'tenant_admin',
      isActive: true,
      rolePermissions: permissions.map((value, index) => {
        const [resource, action] = value.split(':');
        return { permission: { id: `permission-${index}`, resource, action } };
      }),
    },
  }];
}

function appWithRbac() {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: 'user-1', tenantId: 'tenant-1' };
    next();
  });
  app.use(createRbacMiddleware());
  app.get('/auth/users', (_req, res) => res.json({ ok: true }));
  app.get('/auth/users/:id', (_req, res) => res.json({ ok: true }));
  app.post('/auth/users/create', (_req, res) => res.status(201).json({ ok: true }));
  app.patch('/auth/users/:id', (_req, res) => res.json({ ok: true }));
  app.patch('/auth/users/:id/role', (_req, res) => res.json({ ok: true }));
  app.patch('/auth/users/:id/deactivate', (_req, res) => res.json({ ok: true }));
  app.delete('/auth/users/:id', (_req, res) => res.status(204).end());
  app.get('/rbac/roles', (_req, res) => res.json({ ok: true, roles: [] }));
  app.get('/platform/service-probes', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('RBAC middleware /auth/users', () => {
  beforeEach(() => {
    identityFindUnique.mockResolvedValue({ isActive: true, deletedAt: null });
    userRoleFindMany.mockResolvedValue(roleAssignments(['users:read']));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows GET /auth/users when user has users:read', async () => {
    const app = appWithRbac();
    const res = await request(app).get('/auth/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 403 for PATCH /auth/users/:id when user has only users:read', async () => {
    const app = appWithRbac();
    const res = await request(app).patch('/auth/users/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('returns 403 for POST /auth/users/create when user has only users:read', async () => {
    const app = appWithRbac();
    const res = await request(app).post('/auth/users/create');
    expect(res.status).toBe(403);
  });

  it('returns 403 for DELETE /auth/users/:id when user has only users:read', async () => {
    const app = appWithRbac();
    const res = await request(app).delete('/auth/users/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(403);
  });

  it('returns 403 for PATCH /auth/users/:id/role when user has only users:read', async () => {
    const app = appWithRbac();
    const res = await request(app).patch('/auth/users/11111111-1111-1111-1111-111111111111/role');
    expect(res.status).toBe(403);
  });

  it('allows PATCH /auth/users/:id when user has users:update', async () => {
    userRoleFindMany.mockResolvedValue(roleAssignments(['users:read', 'users:update']));
    const app = appWithRbac();
    const res = await request(app).patch('/auth/users/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows PATCH /auth/users/:id/role when user has roles:assign', async () => {
    userRoleFindMany.mockResolvedValue(roleAssignments(['users:read', 'roles:assign']));
    const app = appWithRbac();
    const res = await request(app).patch('/auth/users/11111111-1111-1111-1111-111111111111/role');
    expect(res.status).toBe(200);
  });

  it('returns 503 when the IACMS-local RBAC database is unavailable', async () => {
    userRoleFindMany.mockRejectedValue(new Error('database unavailable'));
    const app = appWithRbac();
    const res = await request(app).get('/auth/users');
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe('POLICY_UNAVAILABLE');
  });

  it('allows GET /rbac/roles when user has workflows:read but not roles:read', async () => {
    userRoleFindMany.mockResolvedValue(roleAssignments(['workflows:read']));
    const app = appWithRbac();
    const res = await request(app).get('/rbac/roles');
    expect(res.status).toBe(200);
  });

  it('returns 403 for GET /rbac/roles when user lacks users:read, workflows:read, and roles:read', async () => {
    userRoleFindMany.mockResolvedValue(roleAssignments(['cases:read']));
    const app = appWithRbac();
    const res = await request(app).get('/rbac/roles');
    expect(res.status).toBe(403);
    expect(res.body.error?.message).toContain('one of:');
  });

  it('returns 403 for GET /platform/service-probes without platform:manage_tenants', async () => {
    userRoleFindMany.mockResolvedValue(roleAssignments(['cases:read', 'workflows:read']));
    const app = appWithRbac();
    const res = await request(app).get('/platform/service-probes');
    expect(res.status).toBe(403);
  });

  it('allows GET /platform/service-probes with platform:manage_tenants', async () => {
    userRoleFindMany.mockResolvedValue(roleAssignments(['platform:manage_tenants']));
    const app = appWithRbac();
    const res = await request(app).get('/platform/service-probes');
    expect(res.status).toBe(200);
  });
});
