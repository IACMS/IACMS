import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as conversationController from '../../src/modules/conversations/conversation.controller.js';
import * as conversationService from '../../src/modules/conversations/conversation.service.js';
import * as wsEvents from '../../src/websocket/events.js';

vi.mock('../../src/modules/conversations/conversation.service.js');
vi.mock('../../src/websocket/events.js', () => ({
  emitConversationCreated: vi.fn().mockResolvedValue(true),
  emitMessagePinned: vi.fn().mockResolvedValue(true),
  emitMessageUnpinned: vi.fn().mockResolvedValue(true),
}));

describe('Conversation Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      actor: { userId: 'u1', tenantId: 't1', departmentId: 'd1' },
      query: {},
      params: {},
      body: {},
      participant: { id: 'p1', role: 'OWNER', conversation: { type: 'GROUP' } },
    };
    res = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('listConversations', () => {
    it('should call ensureDefaultChannels and return conversations list', async () => {
      conversationService.ensureDefaultChannels.mockResolvedValueOnce(undefined);
      conversationService.listUserConversations.mockResolvedValueOnce([
        { id: 'c1', title: 'Agency Channel' },
      ]);

      await conversationController.listConversations(req, res, next);

      expect(conversationService.ensureDefaultChannels).toHaveBeenCalledWith('t1', 'u1', 'd1');
      expect(conversationService.listUserConversations).toHaveBeenCalledWith({
        tenantId: 't1',
        userId: 'u1',
        limit: 50,
        cursor: null,
      });
      expect(res.json).toHaveBeenCalledWith({ conversations: [{ id: 'c1', title: 'Agency Channel' }] });
    });
  });

  describe('createConversation', () => {
    it('should validate type parameter', async () => {
      req.body = { type: 'INVALID' };
      await conversationController.createConversation(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should create DIRECT conversation and emit event', async () => {
      req.body = { type: 'DIRECT', participantId: 'u2' };
      conversationService.findOrCreateDirectConversation.mockResolvedValueOnce({
        id: 'c-direct',
        type: 'DIRECT',
        participants: [{ userId: 'u1' }, { userId: 'u2' }],
      });

      await conversationController.createConversation(req, res, next);

      expect(conversationService.findOrCreateDirectConversation).toHaveBeenCalledWith({
        tenantId: 't1',
        user1Id: 'u1',
        user2Id: 'u2',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(wsEvents.emitConversationCreated).toHaveBeenCalled();
    });

    it('should create GROUP conversation and emit event', async () => {
      req.body = { type: 'GROUP', title: 'My Team', participantIds: ['u2', 'u3'] };
      conversationService.createGroupConversation.mockResolvedValueOnce({
        id: 'c-group',
        type: 'GROUP',
        title: 'My Team',
        participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }],
      });

      await conversationController.createConversation(req, res, next);

      expect(conversationService.createGroupConversation).toHaveBeenCalledWith({
        tenantId: 't1',
        createdBy: 'u1',
        title: 'My Team',
        description: undefined,
        participantIds: ['u1', 'u2', 'u3'],
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(wsEvents.emitConversationCreated).toHaveBeenCalled();
    });
  });

  describe('getConversation, updateConversation, archiveConversation', () => {
    it('getConversation: should return conversation details', async () => {
      req.params = { id: 'c1' };
      conversationService.getConversationDetails.mockResolvedValueOnce({ id: 'c1', title: 'Room' });

      await conversationController.getConversation(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ id: 'c1', title: 'Room' });
    });

    it('updateConversation: should update group metadata', async () => {
      req.params = { id: 'c1' };
      req.body = { title: 'Renamed', description: 'New description' };
      conversationService.updateGroupMetadata.mockResolvedValueOnce({ id: 'c1', title: 'Renamed' });

      await conversationController.updateConversation(req, res, next);
      expect(conversationService.updateGroupMetadata).toHaveBeenCalledWith({
        conversationId: 'c1',
        participant: req.participant,
        title: 'Renamed',
        description: 'New description',
        avatarFileId: undefined,
      });
      expect(res.json).toHaveBeenCalledWith({ id: 'c1', title: 'Renamed' });
    });

    it('archiveConversation: should archive and return 204', async () => {
      req.params = { id: 'c1' };
      conversationService.archiveUserConversation.mockResolvedValueOnce(undefined);

      await conversationController.archiveConversation(req, res, next);
      expect(conversationService.archiveUserConversation).toHaveBeenCalledWith({
        conversationId: 'c1',
        participantId: 'p1',
      });
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('pinMessage, unpinMessage, getPinnedMessage', () => {
    it('pinMessage: should pin and emit message pinned event', async () => {
      req.params = { id: 'c1', messageId: 'm1' };
      conversationService.pinMessage.mockResolvedValueOnce({ id: 'm1', content: 'Pin' });

      await conversationController.pinMessage(req, res, next);
      expect(conversationService.pinMessage).toHaveBeenCalledWith({ conversationId: 'c1', messageId: 'm1' });
      expect(wsEvents.emitMessagePinned).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, pinnedMessage: { id: 'm1', content: 'Pin' } });
    });

    it('unpinMessage: should unpin and emit message unpinned event', async () => {
      req.params = { id: 'c1' };
      conversationService.unpinMessage.mockResolvedValueOnce(undefined);

      await conversationController.unpinMessage(req, res, next);
      expect(conversationService.unpinMessage).toHaveBeenCalledWith({ conversationId: 'c1' });
      expect(wsEvents.emitMessageUnpinned).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('getPinnedMessage: should return pinned message', async () => {
      req.params = { id: 'c1' };
      conversationService.getPinnedMessage.mockResolvedValueOnce({ id: 'm1' });

      await conversationController.getPinnedMessage(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ pinnedMessage: { id: 'm1' } });
    });
  });

  describe('Case-Linked Collaboration: getCaseConversation & initiateCaseConversation', () => {
    it('getCaseConversation: should return case room status', async () => {
      req.params = { caseId: 'case-99' };
      conversationService.getCaseConversation.mockResolvedValueOnce({
        exists: false,
        conversation: null,
      });

      await conversationController.getCaseConversation(req, res, next);
      expect(conversationService.getCaseConversation).toHaveBeenCalledWith({
        tenantId: 't1',
        userId: 'u1',
        caseId: 'case-99',
      });
      expect(res.json).toHaveBeenCalledWith({ exists: false, conversation: null });
    });

    it('initiateCaseConversation: should create room and emit WebSocket event if created', async () => {
      req.params = { caseId: 'case-99' };
      conversationService.initiateCaseConversation.mockResolvedValueOnce({
        created: true,
        conversation: { id: 'conv-new-case', participants: [{ userId: 'u1' }, { userId: 'u2' }] },
      });

      await conversationController.initiateCaseConversation(req, res, next);
      expect(conversationService.initiateCaseConversation).toHaveBeenCalledWith({
        tenantId: 't1',
        userId: 'u1',
        caseId: 'case-99',
      });
      expect(wsEvents.emitConversationCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conv-new-case' }),
        ['u1', 'u2']
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('initiateCaseConversation: should return 200 if room was already created', async () => {
      req.params = { caseId: 'case-99' };
      conversationService.initiateCaseConversation.mockResolvedValueOnce({
        created: false,
        conversation: { id: 'conv-existing-case', participants: [{ userId: 'u1' }] },
      });

      await conversationController.initiateCaseConversation(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(wsEvents.emitConversationCreated).not.toHaveBeenCalled();
    });
  });
});
