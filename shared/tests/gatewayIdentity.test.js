import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hasValidInternalServiceToken,
  buildUserFromGatewayHeaders,
  resolveGatewayIdentity,
  verifyGatewayHeadersInDatabase,
} from '../middleware/gatewayIdentity.js';

describe('gatewayIdentity', () => {
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'gateway-secret';
  });

  afterEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  it('hasValidInternalServiceToken returns true for matching token', () => {
    const req = { headers: { 'x-internal-service-token': 'gateway-secret' } };
    expect(hasValidInternalServiceToken(req)).toBe(true);
  });

  it('buildUserFromGatewayHeaders parses permissions and mustChangePassword', () => {
    const user = buildUserFromGatewayHeaders({
      headers: {
        'x-user-id': 'u1',
        'x-tenant-id': 't1',
        'x-user-email': 'a@b.c',
        'x-user-roles': 'r1,r2',
        'x-user-permissions': 'file:read,cases:read',
        'x-must-change-password': 'true',
      },
    });
    expect(user).toMatchObject({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.c',
      roles: ['r1', 'r2'],
      permissions: ['file:read', 'cases:read'],
      mustChangePassword: true,
    });
  });

  it('resolveGatewayIdentity uses fast path without touching prisma when token is valid', async () => {
    const prisma = { user: { findFirst: vi.fn() } };
    const user = await resolveGatewayIdentity(prisma, {
      headers: {
        'x-internal-service-token': 'gateway-secret',
        'x-user-id': 'u1',
        'x-tenant-id': 't1',
        'x-user-permissions': 'file:upload',
      },
    });
    expect(user?.id).toBe('u1');
    expect(user?.permissions).toEqual(['file:upload']);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('resolveGatewayIdentity falls back to a single DB query when token is absent (dev)', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'u1',
          tenantId: 't1',
          departmentId: null,
          email: 'a@b.c',
          mustChangePassword: false,
          userRoles: [{ roleId: 'r1' }],
        }),
      },
    };
    const user = await resolveGatewayIdentity(prisma, {
      headers: { 'x-user-id': 'u1', 'x-tenant-id': 't1' },
    });
    expect(user?.roles).toEqual(['r1']);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it('verifyGatewayHeadersInDatabase rejects tenant mismatch', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'u1',
          tenantId: 'real-tenant',
          departmentId: null,
          email: 'a@b.c',
          mustChangePassword: false,
          userRoles: [],
        }),
      },
    };
    const user = await verifyGatewayHeadersInDatabase(prisma, {
      headers: { 'x-user-id': 'u1', 'x-tenant-id': 'wrong-tenant' },
    });
    expect(user).toBeNull();
  });
});
