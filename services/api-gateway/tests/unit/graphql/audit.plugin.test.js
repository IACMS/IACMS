/**
 * Audit Plugin Tests
 *
 * Tests the Apollo Server audit plugin to ensure it correctly writes
 * records to the audit outbox on every request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditPlugin } from '../../../src/graphql/plugins/audit.plugin.js';

// Mocks
const mockPrisma = {
  auditOutbox: {
    create: vi.fn().mockResolvedValue({}),
  },
};

describe('Audit Plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes an audit record after request completion', async () => {
    const pluginInstance = await auditPlugin.requestDidStart();

    await pluginInstance.willSendResponse({
      contextValue: {
        tenantId: 'tenant-123',
        apiKeyId: 'key-abc',
        requestId: 'req-1',
        sourceIp: '127.0.0.1',
        prisma: mockPrisma,
      },
      operation: { operation: 'query' },
      request: { operationName: 'GetCases', variables: { filter: { status: 'open' } } },
      response: {},
    });

    expect(mockPrisma.auditOutbox.create).toHaveBeenCalledOnce();
    expect(mockPrisma.auditOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
          payload: expect.objectContaining({
            source: 'partner_api_graphql',
            apiKeyId: 'key-abc',
            operation: 'query',
            operationName: 'GetCases',
            variables: { filter: { status: 'open' } },
            requestId: 'req-1',
            sourceIp: '127.0.0.1',
          }),
        }),
      })
    );
  });

  it('sanitises sensitive variables', async () => {
    const pluginInstance = await auditPlugin.requestDidStart();

    await pluginInstance.willSendResponse({
      contextValue: {
        tenantId: 'tenant-123',
        apiKeyId: 'key-abc',
        requestId: 'req-1',
        prisma: mockPrisma,
      },
      operation: { operation: 'mutation' },
      request: { operationName: 'UpdateUser', variables: { secret: 'super-secret', input: { password: 'test', name: 'John' } } },
      response: {},
    });

    expect(mockPrisma.auditOutbox.create).toHaveBeenCalledOnce();
    
    const payload = mockPrisma.auditOutbox.create.mock.calls[0][0].data.payload;
    expect(payload.variables.secret).toBe('[REDACTED]');
    expect(payload.variables.input.password).toBe('[REDACTED]');
    expect(payload.variables.input.name).toBe('John');
  });

  it('does nothing if context is missing API key', async () => {
    const pluginInstance = await auditPlugin.requestDidStart();

    // No apiKeyId in context (unauthenticated or public route)
    await pluginInstance.willSendResponse({
      contextValue: {
        tenantId: 'tenant-123',
        prisma: mockPrisma,
      },
      operation: { operation: 'query' },
      request: { operationName: 'GetPublicData' },
      response: {},
    });

    expect(mockPrisma.auditOutbox.create).not.toHaveBeenCalled();
  });
});
