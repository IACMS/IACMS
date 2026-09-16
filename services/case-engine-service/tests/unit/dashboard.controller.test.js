import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      caseReferral: {
        findMany: vi.fn(),
      },
      case: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      workflowTransition: {
        findMany: vi.fn(),
      },
      caseHistory: {
        findFirst: vi.fn(),
        groupBy: vi.fn(),
      },
      caseAttachment: {
        groupBy: vi.fn(),
      },
    },
  };
});

vi.mock('../../src/security/caseAccessPolicy.js', () => ({
  userHasTenantWideCaseAccess: vi.fn(),
}));

import prisma from '../../src/config/database.js';
import { getDashboardTasks } from '../../src/controllers/dashboard.controller.js';
import { userHasTenantWideCaseAccess } from '../../src/security/caseAccessPolicy.js';
import { ValidationError } from '../../../../shared/common/errors.js';

describe('Dashboard Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: { 'x-tenant-id': 't-1', 'x-user-id': 'u-1', 'x-user-roles': 'admin,user' },
      query: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('getDashboardTasks', () => {
    it('returns tasks combining referrals and cases', async () => {
      userHasTenantWideCaseAccess.mockResolvedValue(true);
      
      prisma.caseReferral.findMany.mockResolvedValue([
        { id: 'ref-1', caseId: 'c-1', referralReason: 'Please review', case: { priority: 'high' } }
      ]);
      
      prisma.case.findMany.mockResolvedValue([
        { id: 'c-1', currentStepId: 'step-1', assignee: { id: 'u-1' } }
      ]);
      
      prisma.workflowTransition.findMany.mockResolvedValue([]);
      prisma.caseHistory.groupBy.mockResolvedValue([]);
      prisma.caseAttachment.groupBy.mockResolvedValue([]);
      prisma.case.findUnique.mockResolvedValue({ createdAt: new Date() });
      
      await getDashboardTasks(req, res, next);
      if (next.mock.calls.length > 0) {
        console.error('getDashboardTasks failed with:', next.mock.calls[0][0]);
      }
      expect(prisma.caseReferral.findMany).toHaveBeenCalled();
      expect(prisma.case.findMany).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        tasks: expect.arrayContaining([
          expect.objectContaining({ type: 'referral_pending', referralId: 'ref-1' })
        ])
      }));
    });

    it('throws ValidationError if tenantId is missing', async () => {
      req.headers['x-tenant-id'] = undefined;
      await getDashboardTasks(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('throws ValidationError if userId is missing', async () => {
      req.headers['x-user-id'] = undefined;
      await getDashboardTasks(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });
});
