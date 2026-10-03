import { publish } from '../websocket/pubsub.js';

/**
 * Emit a real-time event to all WebSocket clients subscribed to a conversation.
 * This bridges the REST API → WebSocket pipeline.
 *
 * Called from controllers/services after a successful DB mutation.
 */

export async function emitMessageCreated(message) {
  await publish({
    type: 'MESSAGE_CREATED',
    conversationId: message.conversationId,
    participantUserIds: message.participantUserIds || [],
    data: {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId,
      sender: message.sender,
      messageType: message.messageType,
      content: message.content,
      replyToId: message.replyToId,
      attachments: message.attachments,
      createdAt: message.createdAt,
    },
  });
}

export async function emitConversationCreated(conversation, participantUserIds = []) {
  await publish({
    type: 'CONVERSATION_CREATED',
    conversationId: conversation.id,
    participantUserIds,
    data: conversation,
  });
}

export async function emitMessageUpdated(message) {
  await publish({
    type: 'MESSAGE_UPDATED',
    conversationId: message.conversationId,
    data: {
      id: message.id,
      conversationId: message.conversationId,
      content: message.content,
      editedAt: message.editedAt,
    },
  });
}

export async function emitMessageDeleted({ messageId, conversationId, deletedBy }) {
  await publish({
    type: 'MESSAGE_DELETED',
    conversationId,
    data: { messageId, conversationId, deletedBy },
  });
}

export async function emitReactionAdded({ conversationId, messageId, userId, emoji }) {
  await publish({
    type: 'REACTION_ADDED',
    conversationId,
    data: { messageId, userId, emoji },
  });
}

export async function emitReactionRemoved({ conversationId, messageId, userId, emoji }) {
  await publish({
    type: 'REACTION_REMOVED',
    conversationId,
    data: { messageId, userId, emoji },
  });
}

export async function emitReadReceipt({ conversationId, userId, messageId }) {
  await publish({
    type: 'READ_RECEIPT',
    conversationId,
    data: { conversationId, userId, lastReadMessageId: messageId },
  });
}

export async function emitParticipantAdded({ conversationId, participant }) {
  await publish({
    type: 'PARTICIPANT_ADDED',
    conversationId,
    data: { conversationId, participant },
  });
}

export async function emitParticipantRemoved({ conversationId, userId }) {
  await publish({
    type: 'PARTICIPANT_REMOVED',
    conversationId,
    data: { conversationId, userId },
  });
}
