import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticateWsRequest } from '../../src/websocket/ws.auth.js';

describe('WebSocket Auth (authenticateWsRequest)', () => {
  const secret = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long-chat';

  const userPayload = {
    id: 'user-auth-123',
    tenantId: 'tenant-456',
    departmentId: 'dept-789',
    email: 'investigator@iacms.gov',
    firstName: 'Agent',
    lastName: 'Smith',
  };

  it('authenticates successfully via url query parameter (?token=...)', () => {
    const token = jwt.sign(userPayload, secret, { expiresIn: '1h' });
    const req = {
      url: `/ws?token=${token}`,
      headers: {
        host: 'localhost:3010',
      },
    };

    const user = authenticateWsRequest(req);
    expect(user).toBeDefined();
    expect(user.userId).toBe('user-auth-123');
    expect(user.tenantId).toBe('tenant-456');
    expect(user.departmentId).toBe('dept-789');
    expect(user.email).toBe('investigator@iacms.gov');
    expect(user.firstName).toBe('Agent');
    expect(user.lastName).toBe('Smith');
  });

  it('authenticates successfully via Sec-WebSocket-Protocol header', () => {
    const token = jwt.sign(userPayload, secret, { expiresIn: '1h' });
    const req = {
      url: '/ws',
      headers: {
        host: 'localhost:3010',
        'sec-websocket-protocol': `access_token, ${token}`,
      },
    };

    const user = authenticateWsRequest(req);
    expect(user).toBeDefined();
    expect(user.userId).toBe('user-auth-123');
    expect(user.tenantId).toBe('tenant-456');
  });

  it('returns null when no token is provided', () => {
    const req = {
      url: '/ws',
      headers: {
        host: 'localhost:3010',
      },
    };

    const user = authenticateWsRequest(req);
    expect(user).toBeNull();
  });

  it('returns null when token signature is invalid', () => {
    const token = jwt.sign(userPayload, 'wrong-secret-key-that-does-not-match', { expiresIn: '1h' });
    const req = {
      url: `/ws?token=${token}`,
      headers: {
        host: 'localhost:3010',
      },
    };

    const user = authenticateWsRequest(req);
    expect(user).toBeNull();
  });

  it('returns null when token has expired', () => {
    const token = jwt.sign(userPayload, secret, { expiresIn: '-1s' });
    const req = {
      url: `/ws?token=${token}`,
      headers: {
        host: 'localhost:3010',
      },
    };

    const user = authenticateWsRequest(req);
    expect(user).toBeNull();
  });

  it('handles missing departmentId gracefully', () => {
    const payloadNoDept = { ...userPayload, departmentId: undefined };
    const token = jwt.sign(payloadNoDept, secret, { expiresIn: '1h' });
    const req = {
      url: `/ws?token=${token}`,
      headers: {
        host: 'localhost:3010',
      },
    };

    const user = authenticateWsRequest(req);
    expect(user).toBeDefined();
    expect(user.departmentId).toBeNull();
  });
});
