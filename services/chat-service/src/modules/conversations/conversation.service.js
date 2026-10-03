import prisma from '../../config/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../../shared/common/errors.js';

export async function ensureDefaultChannels(tenantId, userId, departmentId) {
  // If departmentId wasn't passed via actor, resolve it from the user record
  let actualDeptId = departmentId;
  if (!actualDeptId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true }
    });
    actualDeptId = user?.departmentId;
  }

  let deptChannelTitle = null;
  let deptName = null;
  if (actualDeptId) {
    const dept = await prisma.department.findUnique({
      where: { id: actualDeptId },
      select: { name: true }
    });
    if (dept?.name) {
      deptName = dept.name;
      deptChannelTitle = `${dept.name} Channel`;
    }
  }

  // Fast path: check if user is already an active member of target channel(s)
  const targetTitles = ['Agency Channel'];
  if (deptChannelTitle) targetTitles.push(deptChannelTitle);

  const existingMemberships = await prisma.chatParticipant.findMany({
    where: {
      userId,
      leftAt: null,
      conversation: {
        tenantId,
        type: 'GROUP',
        title: { in: targetTitles }
      }
    },
    select: {
      conversation: { select: { title: true } }
    }
  });

  const memberTitles = new Set(existingMemberships.map(m => m.conversation.title));

  // 1. Ensure Agency Channel
  if (!memberTitles.has('Agency Channel')) {
    let agencyChannel = await prisma.chatConversation.findFirst({
      where: { tenantId, type: 'GROUP', title: 'Agency Channel' }
    });
    if (!agencyChannel) {
      agencyChannel = await prisma.chatConversation.create({
        data: {
          tenantId,
          type: 'GROUP',
          title: 'Agency Channel',
          description: 'Tenant-wide announcement and discussion channel',
          createdBy: userId
        }
      });
    }
    await prisma.chatParticipant.upsert({
      where: {
        conversationId_userId: { conversationId: agencyChannel.id, userId }
      },
      update: { leftAt: null },
      create: { conversationId: agencyChannel.id, userId, role: 'MEMBER' }
    });
  }

  // 2. Ensure Department Channel
  if (deptChannelTitle && !memberTitles.has(deptChannelTitle)) {
    let deptChannel = await prisma.chatConversation.findFirst({
      where: { tenantId, type: 'GROUP', title: deptChannelTitle }
    });
    if (!deptChannel) {
      deptChannel = await prisma.chatConversation.create({
        data: {
          tenantId,
          type: 'GROUP',
          title: deptChannelTitle,
          description: `Official channel for ${deptName}`,
          createdBy: userId
        }
      });
    }
    await prisma.chatParticipant.upsert({
      where: {
        conversationId_userId: { conversationId: deptChannel.id, userId }
      },
      update: { leftAt: null },
      create: { conversationId: deptChannel.id, userId, role: 'MEMBER' }
    });
  }
}

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
              role: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  username: true
                }
              }
            }
          }
        }
      }
    }
  });

  const unreadCounts = await Promise.all(
    participants.map(async (p) => {
      if (!prisma.chatMessage?.count) return { id: p.conversation.id, count: 0 };
      const count = await prisma.chatMessage.count({
        where: {
          conversationId: p.conversation.id,
          senderId: { not: userId },
          deletedAt: null,
          createdAt: {
            gt: p.lastReadAt || p.joinedAt,
          },
        },
      });
      return { id: p.conversation.id, count };
    })
  );
  const countMap = new Map(unreadCounts.map((u) => [u.id, u.count]));

  return participants.map(p => ({
    id: p.conversation.id,
    type: p.conversation.type,
    title: p.conversation.title,
    lastMessageId: p.conversation.lastMessageId,
    lastMessageAt: p.conversation.lastMessageAt,
    unreadCount: countMap.get(p.conversation.id) || 0,
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
      participants: {
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              username: true
            }
          }
        }
      }
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
      participants: {
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              username: true
            }
          }
        }
      }
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
