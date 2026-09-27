import * as participantService from './participant.service.js';
import { ValidationError } from '../../../../../shared/common/errors.js';

/**
 * GET /conversations/:id/participants
 */
export async function listParticipants(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const participants = await participantService.listParticipants({ conversationId });
    res.json({ participants });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /conversations/:id/participants
 */
export async function addParticipant(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const participant = await participantService.addParticipant({
      conversationId,
      actorParticipant: req.participant,
      userId,
    });

    res.status(201).json(participant);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /conversations/:id/participants/:userId
 */
export async function removeParticipant(req, res, next) {
  try {
    const { id: conversationId, userId: targetUserId } = req.params;

    await participantService.removeParticipant({
      conversationId,
      actorParticipant: req.participant,
      targetUserId,
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /conversations/:id/participants/:userId/role
 */
export async function updateRole(req, res, next) {
  try {
    const { id: conversationId, userId: targetUserId } = req.params;
    const { role } = req.body;

    if (!role) {
      throw new ValidationError('role is required');
    }

    const participant = await participantService.updateParticipantRole({
      conversationId,
      actorParticipant: req.participant,
      targetUserId,
      newRole: role,
    });

    res.json(participant);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /conversations/:id/mute
 */
export async function toggleMute(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const { userId } = req.actor;
    const { muted } = req.body;

    if (typeof muted !== 'boolean') {
      throw new ValidationError('muted (boolean) is required');
    }

    const participant = await participantService.toggleMute({
      conversationId,
      userId,
      muted,
    });

    res.json(participant);
  } catch (error) {
    next(error);
  }
}
