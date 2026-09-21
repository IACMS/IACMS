/**
 * Mutation Resolver Tests
 *
 * Tests the GraphQL mutation helper (mutationHelper.js) in isolation.
 * The underlying mutation handlers are mocked so these tests don't
 * require a database connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphQLError } from 'graphql';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the mutations registry
vi.mock('../../../src/engine/mutations/index.js', () => ({
  getMutation: vi.fn(),
}));

// Mock prisma (not used by helper directly, passed in context)
const mockPrisma = {
  $transaction: vi.fn(async (callback) => {
    return callback(mockPrisma);
  }),
  $executeRaw: vi.fn().mockResolvedValue(),
  auditOutbox: { create: vi.fn().mockResolvedValue({}) },
};

import { getMutation } from '../../../src/engine/mutations/index.js';
import { executeMutation } from '../../../src/graphql/resolvers/mutationHelper.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildContext(scopes = ['*']) {
  return {
    tenantId: 'tenant-123',
    apiKeyId: 'key-abc',
    scopes,
    sourceIp: '127.0.0.1',
    requestId: 'req-test-1',
    prisma: mockPrisma,
  };
}

import { z } from 'zod';

function mockMutation({ requiredScope = 'cases:create', result = { caseId: 'c1' }, schema = z.object({ title: z.string() }) } = {}) {
  return {
    requiredScope,
    schema,
    execute: vi.fn().mockResolvedValue(result),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GraphQL Mutation Helper — executeMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws GraphQLError for unknown mutation action', async () => {
    getMutation.mockReturnValue(null);
    await expect(executeMutation('unknownAction', {}, buildContext())).rejects.toBeInstanceOf(GraphQLError);
  });

  it('throws FORBIDDEN when scope is missing', async () => {
    getMutation.mockReturnValue(mockMutation({ requiredScope: 'cases:create' }));
    await expect(
      executeMutation('createCase', { title: 'Test' }, buildContext(['workflows:read']))
    ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });

  it('allows execution with exact scope', async () => {
    const handler = mockMutation({ requiredScope: 'cases:create', result: { caseId: 'c1' } });
    getMutation.mockReturnValue(handler);

    const result = await executeMutation('createCase', { title: 'Test' }, buildContext(['cases:create']));
    expect(result).toEqual({ caseId: 'c1' });
    expect(handler.execute).toHaveBeenCalledOnce();
  });

  it('allows execution with wildcard scope', async () => {
    const handler = mockMutation({ requiredScope: 'cases:create', result: { caseId: 'c2' } });
    getMutation.mockReturnValue(handler);

    const result = await executeMutation('createCase', { title: 'Test' }, buildContext(['*']));
    expect(result).toEqual({ caseId: 'c2' });
  });

  it('throws VALIDATION_ERROR for invalid Zod input', async () => {
    const handler = mockMutation({
      requiredScope: 'cases:create',
      schema: z.object({ title: z.string().min(10) }), // min 10 chars
    });
    getMutation.mockReturnValue(handler);

    await expect(
      executeMutation('createCase', { title: 'Hi' }, buildContext(['*']))
    ).rejects.toMatchObject({ extensions: { code: 'VALIDATION_ERROR' } });
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('maps Prisma P2002 to CONFLICT GraphQLError', async () => {
    const handler = mockMutation({ requiredScope: 'cases:create' });
    handler.execute.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['email'] } })
    );
    getMutation.mockReturnValue(handler);

    await expect(
      executeMutation('createCase', { title: 'Test' }, buildContext(['*']))
    ).rejects.toMatchObject({ extensions: { code: 'CONFLICT' } });
  });

  it('maps Prisma P2025 to NOT_FOUND GraphQLError', async () => {
    const handler = mockMutation({ requiredScope: 'cases:update' });
    handler.execute.mockRejectedValue(
      Object.assign(new Error('Record not found'), { code: 'P2025' })
    );
    getMutation.mockReturnValue(handler);

    await expect(
      executeMutation('updateCase', { caseId: 'nonexistent', title: 'Test' }, buildContext(['*']))
    ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });

  it('writes audit record after successful execution', async () => {
    const handler = mockMutation({ result: { caseId: 'c3' } });
    getMutation.mockReturnValue(handler);

    await executeMutation('createCase', { title: 'Test' }, buildContext(['*']));

    expect(mockPrisma.auditOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            source: 'partner_api_graphql',
            action: 'createCase',
          }),
        }),
      })
    );
  });
});
