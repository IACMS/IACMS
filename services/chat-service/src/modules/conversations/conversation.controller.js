import * as conversationService from './conversation.service.js';
import { ValidationError } from '../../../../../shared/common/errors.js';

export async function listConversations(req, res, next) {
  try {
    const { userId, tenantId } = req.actor;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

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
