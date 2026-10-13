import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as messageController from '../../src/modules/messages/message.controller.js';
import * as messageService from '../../src/modules/messages/message.service.js';
import * as wsEvents from '../../src/websocket/events.js';

vi.mock('../../src/modules/messages/message.service.js');
vi.mock('../../src/websocket/events.js', () => ({
  emitMessageCreated: vi.fn().mockResolvedValue(true),
  emitMessageUpdated: vi.fn().mockResolvedValue(true),
  emitMessageDeleted: vi.fn().mockResolvedValue(true),
  emitReactionAdded: vi.fn().mockResolvedValue(true),
  emitReactionRemoved: vi.fn().mockResolvedValue(true),
  emitReadReceipt: vi.fn().mockResolvedValue(true),
}));

describe('Message Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      actor: { userId: 'u1', tenantId: 't1' },
      params: { id: 'conv-1', messageId: 'msg-1' },
      body: {},
      query: {},
      participant: { role: 'MEMBER' },
    };
    res = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('sendMessage', () => {
    it('should validate clientMessageId is required', async () => {
      req.body = { messageType: 'TEXT', content: 'Hello' };
      await messageController.sendMessage(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should validate content is required for TEXT messages', async () => {
      req.body = { clientMessageId: 'c-1', messageType: 'TEXT', content: '   ' };
      await messageController.sendMessage(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should send message and emit WebSocket event', async () => {
      req.body = {
        clientMessageId: 'c-1',
        messageType: 'TEXT',
        content: 'Hello team',
        replyToId: 'msg-0',
      };
      messageService.sendMessage.mockResolvedValueOnce({
        id: 'msg-1',
        content: 'Hello team',
      });

      await messageController.sendMessage(req, res, next);

      expect(messageService.sendMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        tenantId: 't1',
        senderId: 'u1',
        clientMessageId: 'c-1',
        messageType: 'TEXT',
        content: 'Hello team',
        replyToId: 'msg-0',
        attachments: undefined,
      });
      expect(wsEvents.emitMessageCreated).toHaveBeenCalledWith({
        id: 'msg-1',
        content: 'Hello team',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 'msg-1', content: 'Hello team' });
    });
  });

  describe('listMessages', () => {
    it('should call messageService.listMessages with parsed limit and cursor', async () => {
      req.query = { limit: '20', cursor: 'msg-cursor' };
      messageService.listMessages.mockResolvedValueOnce({
        messages: [{ id: 'm1' }],
        nextCursor: null,
      });

      await messageController.listMessages(req, res, next);

      expect(messageService.listMessages).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        limit: 20,
        cursor: 'msg-cursor',
      });
      expect(res.json).toHaveBeenCalledWith({
        messages: [{ id: 'm1' }],
        nextCursor: null,
      });
    });
  });

  describe('editMessage', () => {
    it('should validate non-empty content', async () => {
      req.body = { content: '  ' };
      await messageController.editMessage(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should edit message and emit updated event', async () => {
      req.body = { content: 'Edited content' };
      messageService.editMessage.mockResolvedValueOnce({
        id: 'msg-1',
        content: 'Edited content',
      });

      await messageController.editMessage(req, res, next);

      expect(messageService.editMessage).toHaveBeenCalledWith({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u1',
        newContent: 'Edited content',
      });
      expect(wsEvents.emitMessageUpdated).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ id: 'msg-1', content: 'Edited content' });
    });
  });

  describe('deleteMessage', () => {
    it('should delete message and return 204 with WebSocket event', async () => {
      messageService.deleteMessage.mockResolvedValueOnce(undefined);

      await messageController.deleteMessage(req, res, next);

      expect(messageService.deleteMessage).toHaveBeenCalledWith({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        userId: 'u1',
        participantRole: 'MEMBER',
      });
      expect(wsEvents.emitMessageDeleted).toHaveBeenCalledWith({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        deletedBy: 'u1',
      });
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('addReaction and removeReaction', () => {
    it('addReaction: should validate emoji and emit event', async () => {
      req.body = { emoji: '👍' };
      messageService.addReaction.mockResolvedValueOnce({ id: 'r1', emoji: '👍' });

      await messageController.addReaction(req, res, next);

      expect(messageService.addReaction).toHaveBeenCalledWith({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        userId: 'u1',
        emoji: '👍',
      });
      expect(wsEvents.emitReactionAdded).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        userId: 'u1',
        emoji: '👍',
      });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('removeReaction: should remove emoji reaction and return 204', async () => {
      req.params = { id: 'conv-1', messageId: 'msg-1', emoji: '👍' };
      messageService.removeReaction.mockResolvedValueOnce(undefined);

      await messageController.removeReaction(req, res, next);

      expect(messageService.removeReaction).toHaveBeenCalledWith({
        messageId: 'msg-1',
        userId: 'u1',
        emoji: '👍',
      });
      expect(wsEvents.emitReactionRemoved).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        userId: 'u1',
        emoji: '👍',
      });
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('markAsRead', () => {
    it('markAsRead: should validate messageId and record read receipt', async () => {
      req.body = { messageId: 'msg-1' };
      messageService.markAsRead.mockResolvedValueOnce({ success: true });

      await messageController.markAsRead(req, res, next);

      expect(messageService.markAsRead).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        userId: 'u1',
        messageId: 'msg-1',
      });
      expect(wsEvents.emitReadReceipt).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        userId: 'u1',
        messageId: 'msg-1',
      });
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
