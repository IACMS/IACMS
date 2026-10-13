import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as participantController from '../../src/modules/participants/participant.controller.js';
import * as participantService from '../../src/modules/participants/participant.service.js';
import * as wsEvents from '../../src/websocket/events.js';

vi.mock('../../src/modules/participants/participant.service.js');
vi.mock('../../src/websocket/events.js', () => ({
  emitParticipantAdded: vi.fn().mockResolvedValue(true),
  emitParticipantRemoved: vi.fn().mockResolvedValue(true),
}));

describe('Participant Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      actor: { userId: 'u1', tenantId: 't1' },
      params: { id: 'conv-1', userId: 'u2' },
      body: {},
      participant: { role: 'OWNER', userId: 'u1' },
    };
    res = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('listParticipants', () => {
    it('should list all participants in conversation', async () => {
      participantService.listParticipants.mockResolvedValueOnce([{ id: 'p1', userId: 'u1' }]);

      await participantController.listParticipants(req, res, next);

      expect(participantService.listParticipants).toHaveBeenCalledWith({ conversationId: 'conv-1' });
      expect(res.json).toHaveBeenCalledWith({ participants: [{ id: 'p1', userId: 'u1' }] });
    });
  });

  describe('addParticipant', () => {
    it('should validate userId is required', async () => {
      req.body = {};
      await participantController.addParticipant(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should add participant and emit event', async () => {
      req.body = { userId: 'u2' };
      participantService.addParticipant.mockResolvedValueOnce({ id: 'p2', userId: 'u2' });

      await participantController.addParticipant(req, res, next);

      expect(participantService.addParticipant).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        actorParticipant: req.participant,
        userId: 'u2',
      });
      expect(wsEvents.emitParticipantAdded).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        participant: { id: 'p2', userId: 'u2' },
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 'p2', userId: 'u2' });
    });
  });

  describe('removeParticipant', () => {
    it('should remove participant and return 204 with event', async () => {
      participantService.removeParticipant.mockResolvedValueOnce(undefined);

      await participantController.removeParticipant(req, res, next);

      expect(participantService.removeParticipant).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        actorParticipant: req.participant,
        targetUserId: 'u2',
      });
      expect(wsEvents.emitParticipantRemoved).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        userId: 'u2',
      });
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    it('should validate role is required', async () => {
      req.body = {};
      await participantController.updateRole(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should update participant role', async () => {
      req.body = { role: 'ADMIN' };
      participantService.updateParticipantRole.mockResolvedValueOnce({ id: 'p2', role: 'ADMIN' });

      await participantController.updateRole(req, res, next);

      expect(participantService.updateParticipantRole).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        actorParticipant: req.participant,
        targetUserId: 'u2',
        newRole: 'ADMIN',
      });
      expect(res.json).toHaveBeenCalledWith({ id: 'p2', role: 'ADMIN' });
    });
  });

  describe('toggleMute', () => {
    it('should validate boolean muted parameter', async () => {
      req.body = { muted: 'yes' };
      await participantController.toggleMute(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should toggle mute status for user', async () => {
      req.body = { muted: true };
      participantService.toggleMute.mockResolvedValueOnce({ id: 'p1', isMuted: true });

      await participantController.toggleMute(req, res, next);

      expect(participantService.toggleMute).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        userId: 'u1',
        muted: true,
      });
      expect(res.json).toHaveBeenCalledWith({ id: 'p1', isMuted: true });
    });
  });
});
