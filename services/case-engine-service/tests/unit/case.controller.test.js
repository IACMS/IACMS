import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  default: {
    case: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userRole: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    workflow: {
      findFirst: vi.fn(),
    },
    workflowStep: {
      findMany: vi.fn(),
    },
    caseHistory: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
import { getCases, getCase } from '../../src/controllers/case.controller.js';

describe('case.controller unit tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {
        'x-tenant-id': 'tenant-001',
        'x-user-id': 'user-123',
      },
      query: {},
      params: {},
      body: {},
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
    prisma.userRole.findMany.mockResolvedValue([]);
  });

  describe('getCases', () => {
    it('throws ValidationError if x-tenant-id header is missing', async () => {
      req.headers = {};

      await getCases(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'x-tenant-id header required' })
      );
    });

    it('returns cases list for valid tenant header', async () => {
      prisma.case.findMany.mockResolvedValueOnce([
        {
          id: 'case-1',
          caseNumber: 'CAS-2026-0001',
          title: 'Land Dispute Referral',
          tenantId: 'tenant-001',
          status: 'OPEN',
        },
      ]);

      await getCases(req, res, next);

      expect(prisma.case.findMany).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        cases: [
          expect.objectContaining({
            id: 'case-1',
            caseNumber: 'CAS-2026-0001',
          }),
        ],
      });
    });
  });

  describe('getCase', () => {
    it('throws NotFoundError if case does not exist', async () => {
      req.params = { id: 'non-existent' };
      prisma.case.findFirst.mockResolvedValueOnce(null);

      await getCase(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Case not found' })
      );
    });
  });
});
