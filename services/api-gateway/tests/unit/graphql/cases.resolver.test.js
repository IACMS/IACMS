/**
 * Cases Query Resolver Tests
 *
 * Tests the GraphQL query helper (queryHelper.js) via the casesResolver
 * in isolation. The underlying query builder and Prisma client are mocked
 * to prevent hitting the real database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../../src/engine/queryBuilder.js', () => ({
  buildPrismaQuery: vi.fn(),
}));
vi.mock('../../../src/engine/auditWriter.js', () => ({
  writeAuditRecord: vi.fn().mockResolvedValue(),
}));

import { buildPrismaQuery } from '../../../src/engine/queryBuilder.js';
import { writeAuditRecord } from '../../../src/engine/auditWriter.js';
import { casesResolver } from '../../../src/graphql/resolvers/query/cases.resolver.js';

// Mocks
const mockPrisma = {
  $transaction: vi.fn(async (callback) => {
    return callback(mockPrisma);
  }),
  case: {
    findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Case 1' }]),
    count: vi.fn().mockResolvedValue(1),
  },
};

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

// Mock GraphQL resolve info
function buildInfo(selections = ['id', 'title']) {
  return {
    fieldNodes: [
      {
        selectionSet: {
          selections: [
            {
              kind: 'Field',
              name: { value: 'data' },
              selectionSet: {
                selections: selections.map((name) => ({
                  kind: 'Field',
                  name: { value: name },
                })),
              },
            },
          ],
        },
      },
    ],
  };
}

describe('GraphQL Cases Resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates GraphQL args into Prisma query', async () => {
    buildPrismaQuery.mockReturnValue({
      prismaModel: 'case',
      args: { where: { tenantId: 'tenant-123' }, select: { id: true, title: true } },
      countArgs: { where: { tenantId: 'tenant-123' } },
    });

    const filter = { status: { eq: 'open' } };
    const sort = { createdAt: 'desc' };
    const pagination = { limit: 10, offset: 0 };

    const result = await casesResolver(
      null,
      { filter, sort, pagination },
      buildContext(),
      buildInfo()
    );

    expect(buildPrismaQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'cases',
        filter,
        sort,
        pagination,
        select: expect.arrayContaining(['id', 'title']),
      }),
      'tenant-123'
    );

    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.offset).toBe(0);
    expect(result.pagination.hasMore).toBe(false);
  });

  it('writes an audit record for the query', async () => {
    buildPrismaQuery.mockReturnValue({
      prismaModel: 'case',
      args: {},
      countArgs: {},
    });

    await casesResolver(null, {}, buildContext(), buildInfo());

    expect(writeAuditRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-123',
        apiKeyId: 'key-abc',
        operation: 'query',
        entity: 'cases',
        resultCount: 1,
      })
    );
  });

  it('ensures id is always included in the select fields', async () => {
    buildPrismaQuery.mockReturnValue({
      prismaModel: 'case',
      args: {},
      countArgs: {},
    });

    // Requesting ONLY title
    await casesResolver(null, {}, buildContext(), buildInfo(['title']));

    expect(buildPrismaQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        select: ['id', 'title'],
      }),
      'tenant-123'
    );
  });
});
