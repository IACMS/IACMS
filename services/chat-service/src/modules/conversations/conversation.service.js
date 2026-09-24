import prisma from '../../config/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../../shared/common/errors.js';

export async function listUserConversations({ tenantId, userId, limit, cursor }) {
  // Cursor pagination based on lastMessageAt (descending)
  
  const where = {
    userId,
    isArchived: false,
    leftAt: null,
    conversation: {
      tenantId
    }
  };

  if (cursor) {
    const cursorParticipant = await prisma.chatParticipant.findUnique({
      where: { id: cursor },
      include: { conversation: true }
    });

    if (cursorParticipant && cursorParticipant.conversation.lastMessageAt) {
      where.conversation.lastMessageAt = {
        lt: cursorParticipant.conversation.lastMessageAt
      };
    }
  }

  const participants = await prisma.chatParticipant.findMany({
    where,
    take: limit,
    orderBy: {
      conversation: {
        lastMessageAt: 'desc'
      }
    },
    include: {
      conversation: {
        include: {
          participants: {
            where: { leftAt: null },
            select: {
              userId: true,
              role: true
            }
          }
        }
      }
    }
  });

  return participants.map(p => ({
    id: p.conversation.id,
    type: p.conversation.type,
    title: p.conversation.title,
    lastMessageId: p.conversation.lastMessageId,
    lastMessageAt: p.conversation.lastMessageAt,
    unreadCount: 0, // TODO: Implement unread calculation
    participants: p.conversation.participants
  }));
}

export async function findOrCreateDirectConversation({ tenantId, user1Id, user2Id }) {
  // Try to find an existing direct conversation between these two users
  const existing = await prisma.chatConversation.findFirst({
    where: {
      tenantId,
      type: 'DIRECT',
      AND: [
        { participants: { some: { userId: user1Id } } },
        { participants: { some: { userId: user2Id } } }
      ]
    },
    include: {
      participants: true
    }
  });

  if (existing) {
    return existing;
  }

  // Create new DIRECT conversation
  return await prisma.chatConversation.create({
    data: {
      tenantId,
      type: 'DIRECT',
      createdBy: user1Id,
      participants: {
        create: [
          { userId: user1Id, role: 'MEMBER' },
          { userId: user2Id, role: 'MEMBER' }
        ]
      }
    },
    include: {
      participants: true
    }
  });
}

export async function createGroupConversation({ tenantId, createdBy, title, description, participantIds }) {
  return await prisma.chatConversation.create({
    data: {
      tenantId,
      type: 'GROUP',
      title,
      description,
      createdBy,
      participants: {
        create: participantIds.map(userId => ({
          userId,
          role: userId === createdBy ? 'OWNER' : 'MEMBER'
        }))
      }
    },
    include: {
      participants: true
    }
  });
}

export async function getConversationDetails(conversationId) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        where: { leftAt: null }
      }
    }
  });

  if (!conversation) {
    throw new NotFoundError('Conversation not found');
  }

  return conversation;
}

export async function updateGroupMetadata({ conversationId, participant, title, description, avatarFileId }) {
  if (participant.conversation.type !== 'GROUP') {
    throw new ValidationError('Can only update metadata for GROUP conversations');
  }

  if (participant.role === 'MEMBER') {
    throw new ForbiddenError('Only ADMIN or OWNER can update group metadata');
  }

  return await prisma.chatConversation.update({
    where: { id: conversationId },
    data: {
      title,
      description,
      avatarFileId
    }
  });
}

export async function archiveUserConversation({ conversationId, participantId }) {
  await prisma.chatParticipant.update({
    where: { id: participantId },
    data: {
      isArchived: true
    }
  });
}
