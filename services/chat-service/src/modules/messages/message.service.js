import prisma from '../../config/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../../shared/common/errors.js';

/**
 * Send a message inside a conversation.
 * Uses the Transactional Outbox pattern — the message and a ChatOutboxEvent
 * are written in a single Prisma $transaction so either both persist or neither does.
 */
export async function sendMessage({ conversationId, tenantId, senderId, clientMessageId, messageType, content, replyToId, attachments }) {
  if (!clientMessageId) {
    throw new ValidationError('clientMessageId is required for idempotent message delivery');
  }

  // Idempotency: if a message with this clientMessageId already exists, return it
  const existing = await prisma.chatMessage.findUnique({
    where: {
      conversationId_clientMessageId: {
        conversationId,
        clientMessageId,
      },
    },
    include: { attachments: true, sender: { select: { id: true, firstName: true, lastName: true, username: true } } },
  });

  if (existing) {
    return existing;
  }

  // Validate replyToId if provided
  if (replyToId) {
    const parent = await prisma.chatMessage.findFirst({
      where: { id: replyToId, conversationId },
    });
    if (!parent) {
      throw new NotFoundError('Reply target message not found in this conversation');
    }
  }

  // Transactional outbox: create message + outbox event atomically
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create the message
    const message = await tx.chatMessage.create({
      data: {
        conversationId,
        tenantId,
        senderId,
        clientMessageId,
        messageType: messageType || 'TEXT',
        content,
        replyToId,
        attachments: attachments?.length
          ? {
              create: attachments.map((a) => ({
                fileId: a.fileId,
                fileName: a.fileName,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
              })),
            }
          : undefined,
      },
      include: {
        attachments: true,
        sender: { select: { id: true, firstName: true, lastName: true, username: true } },
      },
    });

    // 2. Update conversation's lastMessage pointer
    await tx.chatConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageId: message.id,
        lastMessageAt: message.createdAt,
      },
    });

    // 3. Write the outbox event (picked up by the outbox worker → Kafka)
    await tx.chatOutboxEvent.create({
      data: {
        messageId: message.id,
        eventType: 'CHAT_MESSAGE_CREATED',
        payload: {
          messageId: message.id,
          conversationId,
          tenantId,
          senderId,
          senderName: `${message.sender.firstName} ${message.sender.lastName}`,
          messageType: message.messageType,
          content: message.content,
          replyToId: message.replyToId,
          attachments: message.attachments,
          createdAt: message.createdAt.toISOString(),
        },
      },
    });

    return message;
  });

  return result;
}

/**
 * Fetch messages for a conversation with cursor-based pagination (newest first).
 */
export async function listMessages({ conversationId, limit, cursor }) {
  const where = {
    conversationId,
    deletedAt: null,
  };

  if (cursor) {
    const cursorMessage = await prisma.chatMessage.findUnique({
      where: { id: cursor },
      select: { createdAt: true },
    });

    if (cursorMessage) {
      where.createdAt = { lt: cursorMessage.createdAt };
    }
  }

  const messages = await prisma.chatMessage.findMany({
    where,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, username: true } },
      attachments: true,
      reactions: {
        select: { emoji: true, userId: true },
      },
      replyTo: {
        select: {
          id: true,
          content: true,
          messageType: true,
          senderId: true,
          sender: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;

  return {
    messages,
    nextCursor,
  };
}

/**
 * Edit a message's content. Only the original sender can edit.
 * Writes an outbox event so downstream consumers (WebSocket, notifications) are informed.
 */
export async function editMessage({ messageId, conversationId, senderId, newContent }) {
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, conversationId, deletedAt: null },
  });

  if (!message) {
    throw new NotFoundError('Message not found');
  }

  if (message.senderId !== senderId) {
    throw new ForbiddenError('Only the sender can edit a message');
  }

  if (message.messageType !== 'TEXT') {
    throw new ValidationError('Only TEXT messages can be edited');
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.chatMessage.update({
      where: { id: messageId },
      data: {
        content: newContent,
        editedAt: new Date(),
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, username: true } },
        attachments: true,
      },
    });

    await tx.chatOutboxEvent.create({
      data: {
        messageId,
        eventType: 'CHAT_MESSAGE_UPDATED',
        payload: {
          messageId,
          conversationId,
          senderId,
          content: newContent,
          editedAt: updated.editedAt.toISOString(),
        },
      },
    });

    return updated;
  });

  return result;
}

/**
 * Soft-delete a message. Only the sender or a group ADMIN/OWNER can delete.
 */
export async function deleteMessage({ messageId, conversationId, userId, participantRole }) {
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, conversationId, deletedAt: null },
  });

  if (!message) {
    throw new NotFoundError('Message not found');
  }

  // Sender can always delete their own message; admins/owners can delete anyone's
  const isSender = message.senderId === userId;
  const isAdmin = ['ADMIN', 'OWNER'].includes(participantRole);

  if (!isSender && !isAdmin) {
    throw new ForbiddenError('Insufficient permissions to delete this message');
  }

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    await tx.chatOutboxEvent.create({
      data: {
        messageId,
        eventType: 'CHAT_MESSAGE_DELETED',
        payload: {
          messageId,
          conversationId,
          deletedBy: userId,
          deletedAt: deleted.deletedAt.toISOString(),
        },
      },
    });

    return deleted;
  });

  return result;
}

/**
 * Add a reaction (emoji) to a message.
 */
export async function addReaction({ messageId, conversationId, userId, emoji }) {
  // Verify message exists in conversation
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, conversationId, deletedAt: null },
  });

  if (!message) {
    throw new NotFoundError('Message not found');
  }

  // Upsert — if the reaction already exists, just return it
  const reaction = await prisma.chatReaction.upsert({
    where: {
      messageId_userId_emoji: { messageId, userId, emoji },
    },
    update: {},
    create: { messageId, userId, emoji },
  });

  return reaction;
}

/**
 * Remove a reaction from a message.
 */
export async function removeReaction({ messageId, userId, emoji }) {
  await prisma.chatReaction.deleteMany({
    where: { messageId, userId, emoji },
  });
}

/**
 * Mark all messages in a conversation as read up to a specific message.
 */
export async function markAsRead({ conversationId, userId, messageId }) {
  const participant = await prisma.chatParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });

  if (!participant) {
    throw new NotFoundError('Not a participant in this conversation');
  }

  await prisma.chatParticipant.update({
    where: { id: participant.id },
    data: {
      lastReadMessageId: messageId,
      lastReadAt: new Date(),
    },
  });

  return { conversationId, userId, lastReadMessageId: messageId };
}

/**
 * Get unread count for a user in a conversation.
 */
export async function getUnreadCount({ conversationId, userId }) {
  const participant = await prisma.chatParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });

  if (!participant || !participant.lastReadAt) {
    // Never read — count all messages (excluding own)
    return prisma.chatMessage.count({
      where: {
        conversationId,
        deletedAt: null,
        senderId: { not: userId },
      },
    });
  }

  return prisma.chatMessage.count({
    where: {
      conversationId,
      deletedAt: null,
      senderId: { not: userId },
      createdAt: { gt: participant.lastReadAt },
    },
  });
}
