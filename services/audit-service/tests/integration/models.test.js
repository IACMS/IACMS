/**
 * Integration tests — AuditLog model (Tenant + User relations).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import dotenv from 'dotenv';
import { canConnect, loadSeedUser } from '../../../../shared/tests/db.js';
import { TENANT_CODES } from '../../../../shared/tests/seed-constants.js';

dotenv.config();

const prisma = new PrismaClient();
let app;
let dbReady = false;
let headers = {};

beforeAll(async () => {
  dbReady = await canConnect(prisma);
  if (!dbReady) return;
  const seed = await loadSeedUser(prisma, TENANT_CODES.DCS01, 'admin');
  if (!seed) throw new Error('Seed data missing');
  headers = { 'x-tenant-id': seed.tenant.id, 'x-user-id': seed.user.id };
  ({ default: app } = await import('../../src/server.js'));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(() => !dbReady)('AuditLog model integration', () => {
  it('GET /audit returns paginated logs for tenant', async () => {
    const res = await request(app).get('/audit').set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('POST /audit creates immutable AuditLog row', async () => {
    const payload = {
      tenantId: headers['x-tenant-id'],
      entityType: 'case',
      entityId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: 'test.audit.integration',
      userId: headers['x-user-id'],
      newValues: { ok: true },
    };
    const res = await request(app).post('/audit').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.log.action).toBe('test.audit.integration');

    await prisma.auditLog.delete({ where: { id: res.body.log.id } });
  });
});
