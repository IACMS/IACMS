import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as conversationService from '../../src/modules/conversations/conversation.service.js';
import prisma from '../../src/config/database.js';
import { redis } from '../../src/config/redis.js';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      chatConversation: {
        findFirst: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      chatParticipant: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      chatMessage: {
        findUnique: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      department: {
        findUnique: vi.fn(),
      },
      case: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      caseReferral: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
    },
  };
});

vi.mock('../../src/config/redis.js', () => {
  const store = new Map();
  return {
    redis: {
      get: vi.fn(async (key) => store.get(key) || null),
      set: vi.fn(async (key, val) => { store.set(key, val); return 'OK'; }),
      del: vi.fn(async (key) => { store.delete(key); return 1; }),
    },
  };
});

describe('Conversation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findOrCreateDirectConversation', () => {
    it('should handle creating DIRECT chat with self gracefully', async () => {
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);
      const res = await conversationService.findOrCreateDirectConversation({
        tenantId: 'tenant-1',
        user1Id: 'user-1',
        user2Id: 'user-1',
      });
      expect(res).toBeUndefined();
    });

    it('should return existing DIRECT conversation if one already exists', async () => {
      prisma.chatConversation.findFirst.mockResolvedValueOnce({ id: 'conv-1' });

      const result = await conversationService.findOrCreateDirectConversation({
        tenantId: 'tenant-1',
        user1Id: 'user-1',
        user2Id: 'user-2',
      });

      expect(result.id).toBe('conv-1');
      expect(prisma.chatConversation.create).not.toHaveBeenCalled();
    });

    it('should create a new DIRECT conversation when none exists', async () => {
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);
      prisma.chatConversation.create.mockResolvedValueOnce({
        id: 'new-direct-conv',
        type: 'DIRECT',
        participants: [{ userId: 'user-1' }, { userId: 'user-2' }],
      });

      const result = await conversationService.findOrCreateDirectConversation({
        tenantId: 'tenant-1',
        user1Id: 'user-1',
        user2Id: 'user-2',
      });

      expect(result.id).toBe('new-direct-conv');
      expect(prisma.chatConversation.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('createGroupConversation', () => {
    it('should successfully create a new GROUP conversation', async () => {
      prisma.chatConversation.create.mockResolvedValueOnce({
        id: 'group-1',
        type: 'GROUP',
        title: 'Investigation Unit A',
      });

      const result = await conversationService.createGroupConversation({
        tenantId: 'tenant-1',
        createdBy: 'user-1',
        title: 'Investigation Unit A',
        description: 'Case discussions',
        participantIds: ['user-2', 'user-3'],
      });

      expect(result.id).toBe('group-1');
      expect(prisma.chatConversation.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('listUserConversations', () => {
    it('should return paginated conversations with unread count and latest message', async () => {
      prisma.chatParticipant.findMany.mockResolvedValueOnce([
        { conversation: { id: 'c1', type: 'GROUP' } },
        { conversation: { id: 'c2', type: 'DIRECT' } },
      ]);
      prisma.chatMessage.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);

      const result = await conversationService.listUserConversations({
        tenantId: 'tenant-1',
        userId: 'user-1',
        limit: 10,
      });

      expect(result.length).toBe(2);
      expect(result[0].id).toBe('c1');
      expect(result[1].unreadCount).toBe(3);
    });
  });

  describe('getConversationDetails', () => {
    it('should return conversation details when found', async () => {
      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-100',
        title: 'Team Alpha',
        participants: [{ userId: 'user-1' }],
      });

      const result = await conversationService.getConversationDetails('conv-100');
      expect(result.id).toBe('conv-100');
      expect(result.title).toBe('Team Alpha');
    });

    it('should throw NotFoundError when conversation does not exist', async () => {
      prisma.chatConversation.findUnique.mockResolvedValueOnce(null);
      await expect(conversationService.getConversationDetails('non-existent')).rejects.toThrow('Conversation not found');
    });
  });

  describe('updateGroupMetadata', () => {
    it('should throw ValidationError if conversation is not a GROUP', async () => {
      await expect(
        conversationService.updateGroupMetadata({
          conversationId: 'c1',
          participant: { conversation: { type: 'DIRECT' }, role: 'OWNER' },
          title: 'New Title',
        })
      ).rejects.toThrow('Can only update metadata for GROUP conversations');
    });

    it('should throw ForbiddenError if participant is only a MEMBER', async () => {
      await expect(
        conversationService.updateGroupMetadata({
          conversationId: 'c1',
          participant: { conversation: { type: 'GROUP' }, role: 'MEMBER' },
          title: 'New Title',
        })
      ).rejects.toThrow('Only ADMIN or OWNER can update group metadata');
    });

    it('should successfully update metadata when participant is OWNER or ADMIN', async () => {
      prisma.chatConversation.update.mockResolvedValueOnce({
        id: 'c1',
        title: 'Updated Room',
        description: 'New Description',
      });

      const result = await conversationService.updateGroupMetadata({
        conversationId: 'c1',
        participant: { conversation: { type: 'GROUP' }, role: 'OWNER' },
        title: 'Updated Room',
        description: 'New Description',
        avatarFileId: 'file-1',
      });

      expect(result.title).toBe('Updated Room');
      expect(prisma.chatConversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { title: 'Updated Room', description: 'New Description', avatarFileId: 'file-1' },
      });
    });
  });

  describe('archiveUserConversation', () => {
    it('should mark participant as archived', async () => {
      prisma.chatParticipant.update.mockResolvedValueOnce({ id: 'part-1', isArchived: true });

      await conversationService.archiveUserConversation({
        conversationId: 'c1',
        participantId: 'part-1',
      });

      expect(prisma.chatParticipant.update).toHaveBeenCalledWith({
        where: { id: 'part-1' },
        data: { isArchived: true },
      });
    });
  });

  describe('pinMessage / unpinMessage / getPinnedMessage', () => {
    it('should pin message and cache messageId in redis', async () => {
      prisma.chatMessage.findUnique.mockResolvedValueOnce({
        id: 'msg-1',
        conversationId: 'conv-1',
        content: 'Important Announcement',
      });

      const pinned = await conversationService.pinMessage({
        conversationId: 'conv-1',
        messageId: 'msg-1',
      });

      expect(pinned.id).toBe('msg-1');
      expect(redis.set).toHaveBeenCalledWith('chat:conv:conv-1:pinned', 'msg-1');
    });

    it('should throw NotFoundError if message is not in conversation', async () => {
      prisma.chatMessage.findUnique.mockResolvedValueOnce({
        id: 'msg-1',
        conversationId: 'other-conv',
      });

      await expect(
        conversationService.pinMessage({
          conversationId: 'conv-1',
          messageId: 'msg-1',
        })
      ).rejects.toThrow('Message not found in this conversation');
    });

    it('should unpin message and delete from redis', async () => {
      await conversationService.unpinMessage({ conversationId: 'conv-1' });
      expect(redis.del).toHaveBeenCalledWith('chat:conv:conv-1:pinned');
    });

    it('should retrieve pinned message from redis and db', async () => {
      redis.get.mockResolvedValueOnce('msg-pinned-123');
      prisma.chatMessage.findUnique.mockResolvedValueOnce({
        id: 'msg-pinned-123',
        content: 'Pinned Content',
      });

      const res = await conversationService.getPinnedMessage({ conversationId: 'conv-1' });
      expect(res.id).toBe('msg-pinned-123');
    });

    it('should return null and remove stale redis pin if message was deleted', async () => {
      redis.get.mockResolvedValueOnce('msg-deleted');
      prisma.chatMessage.findUnique.mockResolvedValueOnce({
        id: 'msg-deleted',
        deletedAt: new Date(),
      });

      const res = await conversationService.getPinnedMessage({ conversationId: 'conv-1' });
      expect(res).toBeNull();
      expect(redis.del).toHaveBeenCalledWith('chat:conv:conv-1:pinned');
    });
  });

  describe('Case-Linked Collaboration: getCaseConversation & initiateCaseConversation', () => {
    it('getCaseConversation: should return exists: false when no room has been initiated', async () => {
      prisma.case.findFirst.mockResolvedValueOnce({
        id: 'case-10',
        caseNumber: 'CAS-2026-0010',
        title: 'Theft Investigation',
        status: 'open',
        priority: 'high',
        assignedTo: 'user-detective',
        createdBy: 'user-officer',
      });

      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);

      const res = await conversationService.getCaseConversation({
        tenantId: 'tenant-1',
        userId: 'user-detective',
        caseId: 'case-10',
      });

      expect(res.exists).toBe(false);
      expect(res.conversation).toBeNull();
      expect(res.caseInfo.caseNumber).toBe('CAS-2026-0010');
    });

    it('getCaseConversation: should return exists: true and conversation when already initiated', async () => {
      prisma.case.findFirst.mockResolvedValueOnce({
        id: 'case-10',
        caseNumber: 'CAS-2026-0010',
        title: 'Theft Investigation',
        status: 'open',
        priority: 'high',
      });

      prisma.chatConversation.findFirst.mockResolvedValueOnce({
        id: 'conv-case-10',
        type: 'GROUP',
        title: 'Case #CAS-2026-0010: Theft Investigation',
        participants: [{ userId: 'user-detective' }],
      });

      const res = await conversationService.getCaseConversation({
        tenantId: 'tenant-1',
        userId: 'user-detective',
        caseId: 'case-10',
      });

      expect(res.exists).toBe(true);
      expect(res.isParticipant).toBe(true);
      expect(res.conversation.id).toBe('conv-case-10');
    });

    it('getCaseConversation: should throw NotFoundError if case does not exist or user has no access', async () => {
      prisma.case.findFirst.mockResolvedValueOnce(null);

      await expect(
        conversationService.getCaseConversation({
          tenantId: 'tenant-1',
          userId: 'user-1',
          caseId: 'unknown-case',
        })
      ).rejects.toThrow('Case not found or access denied');
    });

    it('initiateCaseConversation: should create a new discussion room on-demand with announcement', async () => {
      prisma.case.findFirst.mockResolvedValueOnce({
        id: 'case-20',
        caseNumber: 'CAS-2026-0020',
        title: 'Fraud Audit',
        status: 'in_progress',
        priority: 'critical',
        assignedTo: 'user-lead',
        createdBy: 'user-creator',
      });

      // No room exists yet
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);

      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-lead',
        firstName: 'Sherlock',
        lastName: 'Holmes',
        username: 'sherlock',
      });

      prisma.chatConversation.create.mockResolvedValueOnce({
        id: 'conv-new-case-20',
        title: 'Case #CAS-2026-0020: Fraud Audit',
      });

      prisma.chatMessage.create.mockResolvedValueOnce({
        id: 'msg-welcome',
        createdAt: new Date(),
      });

      prisma.chatConversation.update.mockResolvedValueOnce({});

      // Mock getConversationDetails
      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-new-case-20',
        title: 'Case #CAS-2026-0020: Fraud Audit',
        participants: [{ userId: 'user-lead' }, { userId: 'user-creator' }],
      });

      const res = await conversationService.initiateCaseConversation({
        tenantId: 'tenant-1',
        userId: 'user-lead',
        caseId: 'case-20',
      });

      expect(res.created).toBe(true);
      expect(res.conversation.id).toBe('conv-new-case-20');
      expect(prisma.chatConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Case #CAS-2026-0020: Fraud Audit',
            type: 'GROUP',
          }),
        })
      );
      expect(prisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            messageType: 'SYSTEM',
            clientMessageId: expect.stringContaining('system-case-init'),
            content: expect.stringContaining('Sherlock Holmes'),
          }),
        })
      );
    });

    it('initiateCaseConversation: should return existing room and ensure user joins if room already exists', async () => {
      prisma.case.findFirst.mockResolvedValueOnce({
        id: 'case-30',
        caseNumber: 'CAS-2026-0030',
        title: 'Homicide Investigation',
        status: 'open',
        priority: 'critical',
      });

      // Room already exists
      prisma.chatConversation.findFirst.mockResolvedValueOnce({
        id: 'conv-case-30',
        participants: [{ userId: 'user-other' }],
      });

      prisma.chatParticipant.upsert.mockResolvedValueOnce({});

      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-case-30',
        title: 'Case #CAS-2026-0030: Homicide Investigation',
        participants: [{ userId: 'user-other' }, { userId: 'user-new' }],
      });

      const res = await conversationService.initiateCaseConversation({
        tenantId: 'tenant-1',
        userId: 'user-new',
        caseId: 'case-30',
      });

      expect(res.created).toBe(false);
      expect(res.conversation.id).toBe('conv-case-30');
      expect(prisma.chatParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId_userId: {
              conversationId: 'conv-case-30',
              userId: 'user-new',
            },
          },
        })
      );
    });
  });

  describe('Referral-Linked Collaboration: getReferralConversation & initiateReferralConversation', () => {
    it('getReferralConversation: throws ValidationError if referralId missing', async () => {
      await expect(
        conversationService.getReferralConversation({ tenantId: 't1', userId: 'u1' })
      ).rejects.toThrow('referralId is required');
    });

    it('getReferralConversation: throws NotFoundError if referral not found', async () => {
      prisma.caseReferral.findFirst.mockResolvedValueOnce(null);
      await expect(
        conversationService.getReferralConversation({ tenantId: 't1', userId: 'u1', referralId: 'ref-none' })
      ).rejects.toThrow('Referral not found or access denied');
    });

    it('getReferralConversation: returns exists: false when room not initiated', async () => {
      prisma.caseReferral.findFirst.mockResolvedValueOnce({
        id: 'ref-1',
        caseId: 'case-1',
        fromTenantId: 'tenant-1',
        toTenantId: 'tenant-2',
        status: 'pending',
        case: { id: 'case-1', caseNumber: 'CAS-100', title: 'Test Case', status: 'open', priority: 'medium' },
        fromTenant: { id: 'tenant-1', name: 'Police', code: 'POL' },
        toTenant: { id: 'tenant-2', name: 'Child Protection', code: 'CPS' },
      });
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);

      const res = await conversationService.getReferralConversation({
        tenantId: 'tenant-1',
        userId: 'u1',
        referralId: 'ref-1',
      });

      expect(res.exists).toBe(false);
      expect(res.conversation).toBeNull();
      expect(res.referralInfo.fromTenantCode).toBe('POL');
      expect(res.referralInfo.toTenantCode).toBe('CPS');
    });

    it('getReferralConversation: returns exists: true and participant status when room exists', async () => {
      prisma.caseReferral.findFirst.mockResolvedValueOnce({
        id: 'ref-1',
        caseId: 'case-1',
        fromTenantId: 'tenant-1',
        toTenantId: 'tenant-2',
        status: 'accepted',
        case: { id: 'case-1', caseNumber: 'CAS-100', title: 'Test Case', status: 'open', priority: 'medium' },
        fromTenant: { id: 'tenant-1', name: 'Police', code: 'POL' },
        toTenant: { id: 'tenant-2', name: 'Child Protection', code: 'CPS' },
      });
      prisma.chatConversation.findFirst.mockResolvedValueOnce({
        id: 'conv-ref-1',
        participants: [{ userId: 'u1', user: { id: 'u1', firstName: 'John' } }],
      });

      const res = await conversationService.getReferralConversation({
        tenantId: 'tenant-1',
        userId: 'u1',
        referralId: 'ref-1',
      });

      expect(res.exists).toBe(true);
      expect(res.isParticipant).toBe(true);
      expect(res.conversation.id).toBe('conv-ref-1');
    });

    it('initiateReferralConversation: creates cross-tenant room and enrolls participants with welcome message', async () => {
      prisma.caseReferral.findFirst.mockResolvedValueOnce({
        id: 'ref-50',
        caseId: 'case-50',
        fromTenantId: 'tenant-pol',
        toTenantId: 'tenant-cps',
        status: 'accepted',
        referredBy: 'user-pol-officer',
        acceptedBy: 'user-cps-intake',
        case: { id: 'case-50', caseNumber: 'CAS-2026-0050', title: 'Joint Investigation', status: 'open', priority: 'high', assignedTo: 'user-cps-caseworker' },
        fromTenant: { id: 'tenant-pol', name: 'Police Dept', code: 'POL' },
        toTenant: { id: 'tenant-cps', name: 'Child Protection', code: 'CPS' },
      });

      // No existing room
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);

      prisma.user.findUnique.mockResolvedValueOnce({
        firstName: 'Jane',
        lastName: 'Doe',
      });

      prisma.chatConversation.create.mockResolvedValueOnce({
        id: 'conv-ref-50',
        type: 'GROUP',
        title: 'Referral: Case #CAS-2026-0050 (POL → CPS)',
      });

      prisma.chatMessage.create.mockResolvedValueOnce({
        id: 'msg-sys-1',
        createdAt: new Date(),
      });

      prisma.chatConversation.update.mockResolvedValueOnce({});

      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-ref-50',
        title: 'Referral: Case #CAS-2026-0050 (POL → CPS)',
        participants: [
          { userId: 'user-pol-officer' },
          { userId: 'user-cps-intake' },
          { userId: 'user-cps-caseworker' },
          { userId: 'user-caller' },
        ],
      });

      const res = await conversationService.initiateReferralConversation({
        tenantId: 'tenant-pol',
        userId: 'user-caller',
        referralId: 'ref-50',
      });

      expect(res.created).toBe(true);
      expect(res.conversation.id).toBe('conv-ref-50');
      expect(prisma.chatConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Referral: Case #CAS-2026-0050 (POL → CPS)',
            tenantId: 'tenant-pol',
            type: 'GROUP',
          }),
        })
      );
      expect(prisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            messageType: 'SYSTEM',
            clientMessageId: expect.stringContaining('system-referral-init'),
            content: expect.stringContaining('POL → CPS'),
          }),
        })
      );
    });

    it('initiateReferralConversation: joins user to existing room if already created', async () => {
      prisma.caseReferral.findFirst.mockResolvedValueOnce({
        id: 'ref-60',
        caseId: 'case-60',
        fromTenantId: 'tenant-pol',
        toTenantId: 'tenant-cps',
        status: 'pending',
        case: { id: 'case-60', caseNumber: 'CAS-60', title: 'Case 60' },
        fromTenant: { id: 'tenant-pol', code: 'POL' },
        toTenant: { id: 'tenant-cps', code: 'CPS' },
      });

      // Existing room
      prisma.chatConversation.findFirst.mockResolvedValueOnce({
        id: 'conv-ref-60',
        participants: [{ userId: 'user-other' }],
      });

      prisma.chatParticipant.upsert.mockResolvedValueOnce({});

      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-ref-60',
        participants: [{ userId: 'user-other' }, { userId: 'user-joiner' }],
      });

      const res = await conversationService.initiateReferralConversation({
        tenantId: 'tenant-cps',
        userId: 'user-joiner',
        referralId: 'ref-60',
      });

      expect(res.created).toBe(false);
      expect(res.conversation.id).toBe('conv-ref-60');
      expect(prisma.chatParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId_userId: {
              conversationId: 'conv-ref-60',
              userId: 'user-joiner',
            },
          },
        })
      );
    });
  });
});
