/**
 * Integration tests — Role, Permission, RolePermission, UserRole models.
 * Requires PostgreSQL with seed data (npm run db:seed from repo root).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { canConnect, loadSeedUser } from '../../../../shared/tests/db.js';
import {
  ROLE_TENANT_ADMIN_ID,
  ROLE_CASE_MANAGER_ID,
  TENANT_CODES,
} from '../../../../shared/tests/seed-constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const prisma = new PrismaClient();
let app;
let dbReady = false;
let adminUserId;
let tenantId;

beforeAll(async () => {
  dbReady = await canConnect(prisma);
  if (!dbReady) return;
  const seed = await loadSeedUser(prisma, TENANT_CODES.DCS01, 'admin');
  if (!seed) throw new Error('Seed user missing — run npm run db:seed');
  adminUserId = seed.user.id;
  tenantId = seed.tenant.id;
  ({ default: app } = await import('../../src/server.js'));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(() => !dbReady)('Role model integration', () => {
  it('GET /roles returns tenant and global roles', async () => {
    const res = await request(app).get('/roles').query({ tenantId });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.roles)).toBe(true);
    const names = res.body.roles.map((r) => r.name);
    expect(names).toContain('tenant_admin');
  });

  it('GET /roles/:id returns role with RolePermission includes', async () => {
    const res = await request(app).get(`/roles/${ROLE_TENANT_ADMIN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.role.id).toBe(ROLE_TENANT_ADMIN_ID);
    expect(Array.isArray(res.body.role.rolePermissions)).toBe(true);
  });
});

describe.skipIf(() => !dbReady)('Permission model integration', () => {
  it('GET /permissions lists all permissions ordered by resource', async () => {
    const res = await request(app).get('/permissions');
    expect(res.status).toBe(200);
    expect(res.body.permissions.length).toBeGreaterThan(5);
    const resources = res.body.permissions.map((p) => p.resource);
    expect(resources).toContain('cases');
  });
});

describe.skipIf(() => !dbReady)('UserRole + RolePermission integration', () => {
  it('GET /permissions/user/:userId resolves cases:read for tenant admin', async () => {
    const res = await request(app).get(`/permissions/user/${adminUserId}`);
    expect(res.status).toBe(200);
    expect(res.body.permissions).toContain('cases:read');
    expect(res.body.roleIds).toContain(ROLE_TENANT_ADMIN_ID);
  });

  it('GET /permissions/check/:userId denies unknown permission', async () => {
    const res = await request(app)
      .get(`/permissions/check/${adminUserId}`)
      .query({ resource: 'platform', action: 'nope' });
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
  });

  it('GET /user-roles/:userId lists assigned roles', async () => {
    const res = await request(app).get(`/user-roles/${adminUserId}`);
    expect(res.status).toBe(200);
    const roleIds = res.body.userRoles.map((ur) => ur.roleId);
    expect(roleIds).toContain(ROLE_TENANT_ADMIN_ID);
    expect(roleIds).not.toContain(ROLE_CASE_MANAGER_ID);
  });
});
