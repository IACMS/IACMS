import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Configure environment
process.env.NODE_ENV = 'test';
process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token-for-direct-access-guard';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-chars-long-security';

// Mock database to avoid needing active postgres for routing guard assertions
vi.mock('../../src/config/database.js', () => ({
  default: {
    user: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    role: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    permission: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    tenant: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    apiKey: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../../src/identityEvents.js', () => ({
  startIdentityEventPublisher: vi.fn().mockReturnValue(vi.fn()),
  enqueueIdentitySnapshot: vi.fn(),
}));

import app from '../../src/server.js';

describe('Item 4: Supertest tests against full IAM app with no gateway', () => {
  const targetEndpoints = [
    '/roles',
    '/permissions',
    '/auth/users',
    '/api-keys',
    '/tenants',
  ];

  for (const endpoint of targetEndpoints) {
    describe(`Endpoint: GET ${endpoint}`, () => {
      it('(a) returns 401 or 403 when called with no headers', async () => {
        const res = await request(app).get(endpoint);
        expect([401, 403]).toContain(res.status);
      });

      it('(b) returns 401 or 403 when called with forged x-user-* headers', async () => {
        const res = await request(app)
          .get(endpoint)
          .set('x-user-id', 'attacker-user-id')
          .set('x-user-roles', 'system_admin')
          .set('x-tenant-id', 'ADMIN')
          .set('x-user-permissions', 'platform:manage_tenants,iam:admin');

        expect([401, 403]).toContain(res.status);
      });

      it('(c) returns 401 or 403 when called with "Bearer x"', async () => {
        const res = await request(app)
          .get(endpoint)
          .set('Authorization', 'Bearer invalid-junk-token');

        expect([401, 403]).toContain(res.status);
      });
    });
  }
});
