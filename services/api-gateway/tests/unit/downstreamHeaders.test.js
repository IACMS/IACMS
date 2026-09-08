import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  attachInternalServiceToken,
  attachDownstreamHeaders,
} from '../../src/utils/downstreamHeaders.js';

function mockProxyReq() {
  const headers = {};
  return {
    setHeader(name, value) {
      headers[name] = value;
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
});
