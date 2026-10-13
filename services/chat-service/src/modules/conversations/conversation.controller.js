import * as conversationService from './conversation.service.js';
import { ValidationError } from '../../../../../shared/common/errors.js';
import * as wsEvents from '../../websocket/events.js';

export async function listConversations(req, res, next) {
  try {
    const { userId, tenantId, departmentId } = req.actor;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    // Ensure the user is part of the default agency and department channels
    await conversationService.ensureDefaultChannels(tenantId, userId, departmentId);

    const conversations = await conversationService.listUserConversations({
      tenantId,
      userId,
      limit,
      cursor
    });

    res.json({ conversations });
  } catch (error) {
    next(error);
  }
}

export async function createConversation(req, res, next) {
  try {
    const { userId, tenantId } = req.actor;
    const { type, participantId, participantIds, title, description } = req.body;

    if (!type || !['DIRECT', 'GROUP'].includes(type)) {
      throw new ValidationError('Valid type (DIRECT or GROUP) is required');
    }

    let conversation;

    if (type === 'DIRECT') {
      if (!participantId) throw new ValidationError('participantId is required for DIRECT conversations');
      if (participantId === userId) throw new ValidationError('Cannot create DIRECT conversation with yourself');
      
      conversation = await conversationService.findOrCreateDirectConversation({
        tenantId,
        user1Id: userId,
        user2Id: participantId
      });
    } else {
      // GROUP
      if (!title) throw new ValidationError('title is required for GROUP conversations');
      if (!participantIds || !Array.isArray(participantIds)) {
        throw new ValidationError('participantIds array is required for GROUP conversations');
      }

      const allParticipants = [...new Set([userId, ...participantIds])];
      
      conversation = await conversationService.createGroupConversation({
        tenantId,
        createdBy: userId,
        title,
        description,
        participantIds: allParticipants
      });
    }

    const participantUserIds = conversation.participants?.map(p => p.userId) || (type === 'DIRECT' ? [userId, participantId] : allParticipants);
    wsEvents.emitConversationCreated(conversation, participantUserIds).catch(() => {});

    res.status(201).json(conversation);
  } catch (error) {
    next(error);
  }
}

export async function getConversation(req, res, next) {
  try {
    const { id } = req.params;
    
    // Authorization already handled by requireParticipant middleware
    // We just need to fetch the full details
    const conversation = await conversationService.getConversationDetails(id);
    
    res.json(conversation);
  } catch (error) {
    next(error);
  }
}

export async function updateConversation(req, res, next) {
  try {
    const { id } = req.params;
    const { title, description, avatarFileId } = req.body;
    
    const conversation = await conversationService.updateGroupMetadata({
      conversationId: id,
      participant: req.participant, // from middleware
      title,
      description,
      avatarFileId
    });
    
    res.json(conversation);
  } catch (error) {
    next(error);
  }
}

export async function archiveConversation(req, res, next) {
  try {
    const { id } = req.params;
    
    await conversationService.archiveUserConversation({
      conversationId: id,
      participantId: req.participant.id
    });
    
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function pinMessage(req, res, next) {
  try {
    const { id: conversationId, messageId } = req.params;
    const { userId } = req.actor;

    const message = await conversationService.pinMessage({
      conversationId,
      messageId
    });

    wsEvents.emitMessagePinned({
      conversationId,
      messageId,
      pinnedBy: userId,
      message
    }).catch(() => {});

    res.json({ success: true, pinnedMessage: message });
  } catch (error) {
    next(error);
  }
}

export async function unpinMessage(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const { userId } = req.actor;

    await conversationService.unpinMessage({ conversationId });

    wsEvents.emitMessageUnpinned({
      conversationId,
      unpinnedBy: userId
    }).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function getPinnedMessage(req, res, next) {
  try {
    const { id: conversationId } = req.params;
    const pinnedMessage = await conversationService.getPinnedMessage({ conversationId });
    res.json({ pinnedMessage });
  } catch (error) {
    next(error);
  }
}

export async function getCaseConversation(req, res, next) {
  try {
    const { caseId } = req.params;
    const { tenantId, userId } = req.actor;

    const result = await conversationService.getCaseConversation({
      tenantId,
      userId,
      caseId
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function initiateCaseConversation(req, res, next) {
  try {
    const { caseId } = req.params;
    const { tenantId, userId } = req.actor;

    const result = await conversationService.initiateCaseConversation({
      tenantId,
      userId,
      caseId
    });

    if (result.created) {
      const participantUserIds = result.conversation.participants?.map(p => p.userId) || [userId];
      wsEvents.emitConversationCreated(result.conversation, participantUserIds).catch(() => {});
    }

    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

