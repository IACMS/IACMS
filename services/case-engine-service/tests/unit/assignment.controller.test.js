import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      assignment: {
        findMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      case: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
    },
  };
});

const { mockEventBusPublish } = vi.hoisted(() => {
  return { mockEventBusPublish: vi.fn() };
});
vi.mock('../../../../shared/utils/eventBus.js', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      publish: mockEventBusPublish.mockResolvedValue(),
    })),
    TOPICS: {
      CASE_ASSIGNED: 'case.assigned',
      AUDIT_LOG: 'audit.log',
    },
  };
});

import prisma from '../../src/config/database.js';
import { getAssignments, assignCase, unassignCase } from '../../src/controllers/assignment.controller.js';
import { ValidationError, NotFoundError } from '../../../../shared/common/errors.js';

describe('Assignment Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: { 'x-tenant-id': 't-1', 'x-user-id': 'u-1' },
      query: {},
      body: {},
      params: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('getAssignments', () => {
    it('returns assignments for a tenant', async () => {
      const mockAssignments = [{ id: 'a-1' }];
      prisma.assignment.findMany.mockResolvedValue(mockAssignments);

      await getAssignments(req, res, next);

      expect(prisma.assignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ case: { tenantId: 't-1' } })
      }));
      expect(res.json).toHaveBeenCalledWith({ assignments: mockAssignments });
    });

    it('throws ValidationError if tenantId is missing', async () => {
      req.headers['x-tenant-id'] = undefined;
      await getAssignments(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('assignCase', () => {
    it('assigns a case and publishes event', async () => {
      req.body = { caseId: 'c-1', assignedTo: 'u-2' };
      prisma.case.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 't-1' });
      prisma.user.findFirst.mockResolvedValue({ id: 'u-2', tenantId: 't-1', isActive: true });
      prisma.assignment.create.mockResolvedValue({ id: 'a-1', caseId: 'c-1', assignedTo: 'u-2', assignmentType: 'manual' });

      await assignCase(req, res, next);

      expect(prisma.assignment.create).toHaveBeenCalled();
      expect(prisma.case.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { assignedTo: 'u-2' } });
      expect(mockEventBusPublish).toHaveBeenCalledWith('case.assigned', expect.any(Object));
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ assignment: expect.any(Object) });
    });

    it('throws if case is missing', async () => {
      req.body = { caseId: 'c-1', assignedTo: 'u-2' };
      prisma.case.findFirst.mockResolvedValue(null);
      await assignCase(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });

    it('throws ValidationError if assignee missing', async () => {
      req.body = { caseId: 'c-1', assignedTo: 'u-2' };
      prisma.case.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 't-1' });
      prisma.user.findFirst.mockResolvedValue(null);
      await assignCase(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('unassignCase', () => {
    it('unassigns a case', async () => {
      req.params.id = 'a-1';
      prisma.assignment.findFirst.mockResolvedValue({ id: 'a-1', caseId: 'c-1', assignedTo: 'u-2', case: { tenantId: 't-1' } });
      
      await unassignCase(req, res, next);

      expect(prisma.assignment.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a-1' },
        data: expect.objectContaining({ isActive: false })
      }));
      expect(prisma.case.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', assignedTo: 'u-2' },
        data: { assignedTo: null }
      });
      expect(res.json).toHaveBeenCalledWith({ message: 'Case unassigned' });
    });

    it('throws if assignment not found', async () => {
      req.params.id = 'a-1';
      prisma.assignment.findFirst.mockResolvedValue(null);
      await unassignCase(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });
  });
});
