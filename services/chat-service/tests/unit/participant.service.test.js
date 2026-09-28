import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as participantService from '../../src/modules/participants/participant.service.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      chatParticipant: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn((callback) => {
        const tx = {
          chatParticipant: {
            create: vi.fn().mockResolvedValue({ id: 'part-1', role: 'MEMBER' }),
            update: vi.fn().mockResolvedValue({ id: 'part-2', leftAt: new Date() }),
          },
          chatMessage: {
            create: vi.fn(), // System message
          },
        };
        return callback(tx);
      }),
    },
  };
});

describe('Participant Service - Detailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addParticipant', () => {
    it('should throw if conversation is DIRECT', async () => {
      const actorParticipant = { conversation: { type: 'DIRECT' } };
      await expect(participantService.addParticipant({
        conversationId: 'conv-1',
        actorParticipant,
        userId: 'user-2',
      })).rejects.toThrow('Cannot add members to a DIRECT conversation');
    });

    it('should throw if actor is only a MEMBER', async () => {
      const actorParticipant = { role: 'MEMBER', conversation: { type: 'GROUP' } };
      await expect(participantService.addParticipant({
        conversationId: 'conv-1',
        actorParticipant,
        userId: 'user-2',
      })).rejects.toThrow('Only ADMIN or OWNER can add members');
    });

    it('should successfully add user if actor is ADMIN', async () => {
      const actorParticipant = { role: 'ADMIN', conversation: { type: 'GROUP', tenantId: 'tenant-1' } };
      prisma.chatParticipant.findUnique.mockResolvedValueOnce(null); // not already in group
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'user-2', firstName: 'Jane', lastName: 'Doe', tenantId: 'tenant-1' });

      const result = await participantService.addParticipant({
        conversationId: 'conv-1',
        actorParticipant,
        userId: 'user-2',
      });

      expect(result.id).toBe('part-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeParticipant', () => {
    it('should throw if actor is MEMBER trying to remove someone else', async () => {
      const actorParticipant = { role: 'MEMBER', userId: 'user-1', conversation: { type: 'GROUP' } };
      await expect(participantService.removeParticipant({
        conversationId: 'conv-1',
        actorParticipant,
        userIdToRemove: 'user-2',
      })).rejects.toThrow('Insufficient permissions to remove members');
    });

    it('should allow MEMBER to remove themselves (leave group)', async () => {
      const actorParticipant = { role: 'MEMBER', userId: 'user-1', conversation: { type: 'GROUP' } };
      prisma.chatParticipant.findUnique.mockResolvedValueOnce({ id: 'part-1', userId: 'user-1', leftAt: null, user: { firstName: 'John', lastName: 'Doe' } });
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'user-1', firstName: 'John', lastName: 'Doe' });

      const result = await participantService.removeParticipant({
        conversationId: 'conv-1',
        actorParticipant,
        targetUserId: 'user-1', // Self
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateParticipantRole', () => {
    it('should throw if actor is not OWNER', async () => {
      const actorParticipant = { role: 'ADMIN', userId: 'user-1' };
      await expect(participantService.updateParticipantRole({
        conversationId: 'conv-1',
        actorParticipant,
        targetUserId: 'user-2',
        newRole: 'ADMIN'
      })).rejects.toThrow();
    });
  });
});
