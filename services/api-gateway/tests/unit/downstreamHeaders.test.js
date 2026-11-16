import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachInternalServiceToken,
  attachDownstreamHeaders,
  stripInboundGatewayHeaders,
} from '../../src/utils/downstreamHeaders.js';

function mockProxyReq() {
  const headers = {};
  return {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name) {
      delete headers[name.toLowerCase()];
    },
    getHeaders() {
      return headers;
    },
    headers,
  };
}

describe('downstreamHeaders', () => {
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'prod-gateway-token';
  });

  afterEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = originalToken;
  });

  it('attachInternalServiceToken sets x-internal-service-token on every proxy', () => {
    const proxyReq = mockProxyReq();
    attachInternalServiceToken(proxyReq);
    expect(proxyReq.headers['x-internal-service-token']).toBe('prod-gateway-token');
  });

  it('attachDownstreamHeaders injects internal token even without req.user (public auth routes)', () => {
    const proxyReq = mockProxyReq();
    attachDownstreamHeaders(proxyReq, {});
    expect(proxyReq.headers['x-internal-service-token']).toBe('prod-gateway-token');
    expect(proxyReq.headers['x-user-id']).toBeUndefined();
  });

  it('attachDownstreamHeaders forwards identity and RBAC envelope when user is present', () => {
    const proxyReq = mockProxyReq();
    attachDownstreamHeaders(proxyReq, {
      user: {
        id: 'u1',
        tenantId: 't1',
        departmentId: 'd1',
        email: 'a@b.c',
        mustChangePassword: true,
        roles: ['legacy-role'],
      },
      rbacEnvelope: {
        roleIds: ['role-uuid'],
        permissions: ['cases:read', 'file:upload'],
      },
    });

    expect(proxyReq.headers['x-internal-service-token']).toBe('prod-gateway-token');
    expect(proxyReq.headers['x-user-id']).toBe('u1');
    expect(proxyReq.headers['x-tenant-id']).toBe('t1');
    expect(proxyReq.headers['x-department-id']).toBe('d1');
    expect(proxyReq.headers['x-user-email']).toBe('a@b.c');
    expect(proxyReq.headers['x-must-change-password']).toBe('true');
    expect(proxyReq.headers['x-user-roles']).toBe('role-uuid');
    expect(proxyReq.headers['x-user-permissions']).toBe('cases:read,file:upload');
  });

  it('strips all inbound client-sent x-user-*, x-tenant-id, x-must-change-password and x-internal-service-token headers', () => {
    const proxyReq = mockProxyReq();
    proxyReq.setHeader('x-user-permissions', 'platform:manage_tenants');
    proxyReq.setHeader('x-user-roles', 'system_admin');
    proxyReq.setHeader('x-user-id', 'attacker-user');
    proxyReq.setHeader('x-tenant-id', 'attacker-tenant');
    proxyReq.setHeader('x-must-change-password', 'false');
    proxyReq.setHeader('x-internal-service-token', 'stolen-or-spoofed-token');

    attachDownstreamHeaders(proxyReq, {});

    expect(proxyReq.headers['x-user-permissions']).toBeUndefined();
    expect(proxyReq.headers['x-user-roles']).toBeUndefined();
    expect(proxyReq.headers['x-user-id']).toBeUndefined();
    expect(proxyReq.headers['x-tenant-id']).toBeUndefined();
    expect(proxyReq.headers['x-must-change-password']).toBeUndefined();
    expect(proxyReq.headers['x-internal-service-token']).toBe('prod-gateway-token');
  });

  it('stripInboundGatewayHeaders removes all inbound spoofed headers from req.headers', () => {
    const req = {
      headers: {
        'x-user-permissions': 'platform:manage_tenants',
        'x-user-roles': 'system_admin',
        'x-tenant-id': 'evil-tenant',
        'x-must-change-password': 'false',
        'x-internal-service-token': 'evil-token',
        'x-user-id': 'evil-user',
        authorization: 'Bearer valid-token',
      },
    };
    const res = {};
    const next = vi.fn();

    stripInboundGatewayHeaders(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.headers['x-user-permissions']).toBeUndefined();
    expect(req.headers['x-user-roles']).toBeUndefined();
    expect(req.headers['x-tenant-id']).toBeUndefined();
    expect(req.headers['x-must-change-password']).toBeUndefined();
    expect(req.headers['x-internal-service-token']).toBeUndefined();
    expect(req.headers['x-user-id']).toBeUndefined();
    expect(req.headers['authorization']).toBe('Bearer valid-token');
  });
});
