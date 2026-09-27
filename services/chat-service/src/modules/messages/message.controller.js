import * as messageService from './message.service.js';
import { ValidationError } from '../../../../../shared/common/errors.js';

/**
 * POST /conversations/:id/messages
 */
export async function sendMessage(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const { userId, tenantId } = req.actor;
    const { clientMessageId, messageType, content, replyToId, attachments } = req.body;

    if (!clientMessageId) {
      throw new ValidationError('clientMessageId is required');
    }

    if (messageType === 'TEXT' && !content?.trim()) {
      throw new ValidationError('content is required for TEXT messages');
    }

    const message = await messageService.sendMessage({
      conversationId,
      tenantId,
      senderId: userId,
      clientMessageId,
      messageType,
      content,
      replyToId,
      attachments,
    });

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /conversations/:id/messages
 */
export async function listMessages(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const cursor = req.query.cursor || null;

    const result = await messageService.listMessages({
      conversationId,
      limit,
      cursor,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /conversations/:id/messages/:messageId
 */
export async function editMessage(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params;
    const { userId } = req.actor;
    const { content } = req.body;

    if (!content?.trim()) {
      throw new ValidationError('content is required');
    }

    const message = await messageService.editMessage({
      messageId,
      conversationId,
      senderId: userId,
      newContent: content,
    });

    res.json(message);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /conversations/:id/messages/:messageId
 */
export async function deleteMessage(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params;
    const { userId } = req.actor;
    const participantRole = req.participant.role;

    await messageService.deleteMessage({
      messageId,
      conversationId,
      userId,
      participantRole,
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /conversations/:id/messages/:messageId/reactions
 */
export async function addReaction(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params;
    const { userId } = req.actor;
    const { emoji } = req.body;

    if (!emoji) {
      throw new ValidationError('emoji is required');
    }

    const reaction = await messageService.addReaction({
      messageId,
      conversationId,
      userId,
      emoji,
    });

    res.status(201).json(reaction);
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /conversations/:id/messages/:messageId/reactions/:emoji
 */
export async function removeReaction(req, res, next) {
  try {
    const { messageId, emoji } = req.params;
    const { userId } = req.actor;

    await messageService.removeReaction({ messageId, userId, emoji });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /conversations/:id/read
 */
export async function markAsRead(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const { userId } = req.actor;
    const { messageId } = req.body;

    if (!messageId) {
      throw new ValidationError('messageId is required');
    }

    const receipt = await messageService.markAsRead({
      conversationId,
      userId,
      messageId,
    });

    res.json(receipt);
  } catch (error) {
    next(error);
  }
}
