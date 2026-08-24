import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  default: {
    caseReferral: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    case: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../../../shared/utils/eventBus.js', () => ({
  default: vi.fn().mockImplementation(function () {
    this.publish = vi.fn().mockResolvedValue(true);
  }),
  TOPICS: { AUDIT_LOG: 'audit.log' },
}));

import prisma from '../../src/config/database.js';
import { getReferrals } from '../../src/controllers/referral.controller.js';

describe('referral.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {
        'x-tenant-id': 'tenant-001',
        'x-user-id': 'user-123',
      },
      query: {},
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it('fetches referrals scoped to actor tenant id', async () => {
    prisma.caseReferral.findMany.mockResolvedValueOnce([
      {
        id: 'ref-1',
        fromTenantId: 'tenant-001',
        toTenantId: 'tenant-002',
        status: 'PENDING',
        referredAt: new Date('2026-08-01'),
        case: { id: 'case-1', updatedAt: new Date('2026-08-01') },
      },
    ]);

    await getReferrals(req, res, next);

    expect(prisma.caseReferral.findMany).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      referrals: [
        expect.objectContaining({
          id: 'ref-1',
          status: 'PENDING',
        }),
      ],
    });
  });
});
