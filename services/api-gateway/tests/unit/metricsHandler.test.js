import { vi, describe, it, expect, beforeEach } from 'vitest';
import { executeMetricsQuery } from '../../src/engine/metricsHandler.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    $transaction: vi.fn(),
  }
}));

// We need a way to track the mocked functions within the transaction
let mockCount;
let mockQueryRaw;

describe('metricsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockCount = vi.fn();
    mockQueryRaw = vi.fn();
    
    prisma.$transaction.mockImplementation(async (callback) => {
      return callback({
        case: { count: mockCount },
        $queryRaw: mockQueryRaw,
        auditOutbox: { create: vi.fn() }
      });
    });
  });

  const baseContext = {
    tenantId: 'tenant-123',
    apiKeyId: 'key-123',
    sourceIp: '127.0.0.1',
    requestId: 'req-456'
  };

  it('selects all fields when none are specified', async () => {
    mockCount.mockImplementation(({ where }) => {
      if (where.dueDate) return Promise.resolve(5); // overdueCount
      if (where.status === 'open') return Promise.resolve(20); // openCases
      if (where.status === 'closed') return Promise.resolve(80); // closedCases
      return Promise.resolve(100); // totalCases
    });
    mockQueryRaw.mockResolvedValue([{ avgDays: '15.25' }]);

    const query = { entity: 'metrics' };
    const response = await executeMetricsQuery(query, baseContext);

    expect(response.success).toBe(true);
    expect(response.data).toHaveLength(1);
    
    const data = response.data[0];
    expect(data.totalCases).toBe(100);
    expect(data.openCases).toBe(20);
    expect(data.closedCases).toBe(80);
    expect(data.overdueCount).toBe(5);
    expect(data.avgResolutionDays).toBe(15.25);
    
    expect(mockCount).toHaveBeenCalledTimes(4);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('only calculates requested fields', async () => {
    mockCount.mockResolvedValue(42);

    const query = { 
      entity: 'metrics', 
      select: ['openCases'] 
    };
    
    const response = await executeMetricsQuery(query, baseContext);

    expect(response.data[0].openCases).toBe(42);
    expect(response.data[0].totalCases).toBeUndefined();
    expect(response.data[0].avgResolutionDays).toBeUndefined();
    
    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('rejects invalid fields', async () => {
    const query = { 
      entity: 'metrics', 
      select: ['openCases', 'invalidField'] 
    };
    
    await expect(executeMetricsQuery(query, baseContext)).rejects.toThrow(/invalidField/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('handles null raw query results gracefully (no resolved cases)', async () => {
    mockQueryRaw.mockResolvedValue([{ avgDays: null }]);

    const query = { 
      entity: 'metrics', 
      select: ['avgResolutionDays'] 
    };
    
    const response = await executeMetricsQuery(query, baseContext);

    expect(response.data[0].avgResolutionDays).toBe(0);
  });
});
