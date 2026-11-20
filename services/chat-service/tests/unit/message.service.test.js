import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as messageService from '../../src/modules/messages/message.service.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      chatMessage: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      chatConversation: {
        update: vi.fn(),
      },
      chatOutboxEvent: {
        create: vi.fn(),
      },
      chatParticipant: {
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      chatReaction: {
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn((callback) => {
        // Mock the transaction object
        const tx = {
          chatMessage: {
            create: vi.fn().mockResolvedValue({ id: 'msg-1', createdAt: new Date(), messageType: 'TEXT', content: 'hello', sender: { firstName: 'John', lastName: 'Doe' } }),
            update: vi.fn().mockResolvedValue({ id: 'msg-1', editedAt: new Date(), deletedAt: new Date() }),
          },
          chatConversation: { update: vi.fn() },
          chatOutboxEvent: { create: vi.fn() },
          chatParticipant: {
            findMany: vi.fn().mockResolvedValue([{ userId: 'user-2' }]),
            updateMany: vi.fn(),
          },
          chatReaction: { create: vi.fn(), delete: vi.fn(), upsert: vi.fn() }
        };
        return callback(tx);
      }),
    },
  };
});

describe('Message Service - Detailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should be idempotent and return existing message if clientMessageId exists', async () => {
      prisma.chatMessage.findUnique.mockResolvedValueOnce({ id: 'existing-msg', clientMessageId: 'client-1' });

      const result = await messageService.sendMessage({
        conversationId: 'conv-1',
        tenantId: 'tenant-1',
        senderId: 'user-1',
        clientMessageId: 'client-1',
        content: 'Hello',
      });

      expect(result.id).toBe('existing-msg');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create message, update conversation, and write outbox event via transaction', async () => {
      prisma.chatMessage.findUnique.mockResolvedValueOnce(null); // No existing idempotency match

      const result = await messageService.sendMessage({
        conversationId: 'conv-1',
        tenantId: 'tenant-1',
        senderId: 'user-1',
        clientMessageId: 'client-2',
        content: 'New message',
      });

      expect(result.id).toBe('msg-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('editMessage', () => {
    it('should throw if sender is not the original author', async () => {
      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-1',
        senderId: 'user-2', // different sender
        messageType: 'TEXT',
      });

      await expect(messageService.editMessage({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-1', // malicious edit
        newContent: 'Hacked',
      })).rejects.toThrow('Only the sender can edit a message');
    });

    it('should throw if trying to edit a non-TEXT message', async () => {
      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-1',
        senderId: 'user-1',
        messageType: 'SYSTEM',
      });

      await expect(messageService.editMessage({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        newContent: 'Update',
      })).rejects.toThrow('Only TEXT messages can be edited');
    });

    it('should successfully edit a TEXT message via transaction', async () => {
      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-1',
        senderId: 'user-1',
        messageType: 'TEXT',
        content: 'Original',
      });

      const result = await messageService.editMessage({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        newContent: 'Updated Content',
      });

      expect(result.id).toBe('msg-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteMessage', () => {
    it('should soft delete message and create outbox event', async () => {
      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-1',
        senderId: 'user-1',
      });

      await messageService.deleteMessage({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        participantRole: 'MEMBER'
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('addReaction', () => {
    it('should upsert reaction to the message', async () => {
      // Mock message existence
      prisma.chatMessage.findFirst.mockResolvedValueOnce({ id: 'msg-1' });
      prisma.chatReaction.upsert.mockResolvedValueOnce({ id: 'react-1' });

      await messageService.addReaction({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        emoji: '👍'
      });

      expect(prisma.chatReaction.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
