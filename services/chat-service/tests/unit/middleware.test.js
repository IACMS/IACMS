import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actorFromHeaders, attachActor } from '../../src/middleware/actor.js';
import { requireParticipant } from '../../src/middleware/conversation.auth.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    chatParticipant: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Chat Service Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
      params: {},
    };
    res = {};
    next = vi.fn();
  });

  describe('actor.js - actorFromHeaders & attachActor', () => {
    it('should throw ValidationError if identity headers are missing', () => {
      req.headers = { 'x-tenant-id': 't1' }; // missing x-user-id
      expect(() => actorFromHeaders(req)).toThrow('Missing identity headers (x-tenant-id or x-user-id)');
    });

    it('should extract tenantId, userId, and departmentId from headers', () => {
      req.headers = {
        'x-tenant-id': 't1',
        'x-user-id': 'u1',
        'x-department-id': 'd1',
      };
      const actor = actorFromHeaders(req);
      expect(actor).toEqual({
        tenantId: 't1',
        userId: 'u1',
        departmentId: 'd1',
      });
    });

    it('attachActor middleware should attach actor to req and call next', () => {
      req.headers = {
        'x-tenant-id': 't1',
        'x-user-id': 'u1',
      };
      attachActor(req, res, next);
      expect(req.actor).toEqual({
        tenantId: 't1',
        userId: 'u1',
        departmentId: null,
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('attachActor middleware should call next with error when invalid headers', () => {
      req.headers = {};
      attachActor(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('conversation.auth.js - requireParticipant', () => {
    beforeEach(() => {
      req.headers = {
        'x-tenant-id': 't1',
        'x-user-id': 'u1',
      };
      req.params = { id: 'conv-10' };
    });

    it('should throw ForbiddenError if user is not active participant in conversation', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(null);

      await requireParticipant(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Not an active member of this conversation',
        })
      );
    });

    it('should attach participant and conversation to req when authorized', async () => {
      const mockParticipant = {
        id: 'p1',
        userId: 'u1',
        role: 'MEMBER',
        conversation: { id: 'conv-10', type: 'GROUP' },
      };
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(mockParticipant);

      await requireParticipant(req, res, next);

      expect(req.participant).toBe(mockParticipant);
      expect(req.conversation).toBe(mockParticipant.conversation);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
