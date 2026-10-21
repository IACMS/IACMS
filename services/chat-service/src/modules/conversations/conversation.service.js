import prisma from '../../config/database.js';
import { redis } from '../../config/redis.js';
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
      OR: [
        { tenantId },
        { description: { contains: '"referralId"' } }
      ]
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
      participants: {
        where: { leftAt: null },
        include: {
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
  });
}

export async function getConversationDetails(conversationId) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        where: { leftAt: null },
        include: {
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

  const isOwnerOrAdmin =
    participant.role === 'OWNER' ||
    participant.role === 'ADMIN' ||
    (Boolean(participant.userId) && Boolean(participant.conversation.createdBy) && participant.conversation.createdBy === participant.userId);

  if (!isOwnerOrAdmin) {
    throw new ForbiddenError('Only ADMIN or OWNER can update group metadata');
  }

  return await prisma.chatConversation.update({
    where: { id: conversationId },
    data: {
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(avatarFileId !== undefined ? { avatarFileId } : {})
    }
  });
}

export async function deleteConversation({ conversationId, participant, userId }) {
  const conv = participant.conversation;
  if (conv.type !== 'GROUP') {
    throw new ValidationError('Only GROUP conversations can be deleted');
  }

  if (conv.title === 'Agency Channel') {
    throw new ForbiddenError('The default Agency Channel cannot be deleted');
  }

  const isOwnerOrAdmin = participant.role === 'OWNER' || participant.role === 'ADMIN' || conv.createdBy === userId;
  if (!isOwnerOrAdmin) {
    throw new ForbiddenError('Only group OWNER or ADMIN can delete this group');
  }

  const activeParticipants = await prisma.chatParticipant.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true }
  });
  const participantUserIds = activeParticipants.map(p => p.userId);

  await prisma.chatConversation.delete({
    where: { id: conversationId }
  });

  return { conversationId, participantUserIds };
}

export async function archiveUserConversation({ conversationId, participantId }) {
  await prisma.chatParticipant.update({
    where: { id: participantId },
    data: {
      isArchived: true
    }
  });
}

export async function pinMessage({ conversationId, messageId }) {
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, email: true } },
      attachments: true
    }
  });

  if (!message || message.conversationId !== conversationId) {
    throw new NotFoundError('Message not found in this conversation');
  }

  await redis.set(`chat:conv:${conversationId}:pinned`, messageId);
  return message;
}

export async function unpinMessage({ conversationId }) {
  await redis.del(`chat:conv:${conversationId}:pinned`);
}

export async function getPinnedMessage({ conversationId }) {
  const messageId = await redis.get(`chat:conv:${conversationId}:pinned`);
  if (!messageId) return null;

  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, email: true } },
      attachments: true
    }
  });

  if (!message || message.deletedAt) {
    await redis.del(`chat:conv:${conversationId}:pinned`);
    return null;
  }

  return message;
}

export async function getCaseConversation({ tenantId, userId, caseId }) {
  if (!caseId) {
    throw new ValidationError('caseId is required');
  }

  const caseRecord = await prisma.case.findFirst({
    where: {
      id: caseId,
      deletedAt: null,
      OR: [
        { tenantId },
        { originatingTenantId: tenantId },
        { currentTenantId: tenantId }
      ]
    },
    select: {
      id: true,
      caseNumber: true,
      title: true,
      status: true,
      priority: true,
      assignedTo: true,
      createdBy: true
    }
  });

  if (!caseRecord) {
    throw new NotFoundError('Case not found or access denied');
  }

  const conversation = await prisma.chatConversation.findFirst({
    where: {
      tenantId,
      type: 'GROUP',
      description: {
        contains: `"caseId":"${caseId}"`
      },
      isArchived: false
    },
    include: {
      participants: {
        where: { leftAt: null },
        include: {
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
  });

  if (!conversation) {
    return {
      exists: false,
      conversation: null,
      caseInfo: {
        id: caseRecord.id,
        caseNumber: caseRecord.caseNumber,
        title: caseRecord.title,
        status: caseRecord.status,
        priority: caseRecord.priority
      }
    };
  }

  const isParticipant = conversation.participants.some(p => p.userId === userId);

  return {
    exists: true,
    isParticipant,
    conversation,
    caseInfo: {
      id: caseRecord.id,
      caseNumber: caseRecord.caseNumber,
      title: caseRecord.title,
      status: caseRecord.status,
      priority: caseRecord.priority
    }
  };
}

export async function initiateCaseConversation({ tenantId, userId, caseId }) {
  if (!caseId) {
    throw new ValidationError('caseId is required');
  }

  const caseRecord = await prisma.case.findFirst({
    where: {
      id: caseId,
      deletedAt: null,
      OR: [
        { tenantId },
        { originatingTenantId: tenantId },
        { currentTenantId: tenantId }
      ]
    },
    select: {
      id: true,
      caseNumber: true,
      title: true,
      status: true,
      priority: true,
      assignedTo: true,
      createdBy: true
    }
  });

  if (!caseRecord) {
    throw new NotFoundError('Case not found or access denied');
  }

  let conversation = await prisma.chatConversation.findFirst({
    where: {
      tenantId,
      type: 'GROUP',
      description: {
        contains: `"caseId":"${caseId}"`
      },
      isArchived: false
    },
    include: {
      participants: {
        where: { leftAt: null }
      }
    }
  });

  if (conversation) {
    const isMember = conversation.participants.some(p => p.userId === userId);
    if (!isMember) {
      await prisma.chatParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId
          }
        },
        create: {
          conversationId: conversation.id,
          userId,
          role: 'MEMBER'
        },
        update: {
          leftAt: null,
          role: 'MEMBER'
        }
      });
    }
    const fullConversation = await getConversationDetails(conversation.id);
    return {
      created: false,
      conversation: fullConversation,
      caseInfo: {
        id: caseRecord.id,
        caseNumber: caseRecord.caseNumber,
        title: caseRecord.title,
        status: caseRecord.status,
        priority: caseRecord.priority
      }
    };
  }

  const initiator = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, username: true }
  });
  const initiatorName = (
    initiator
      ? `${initiator.firstName || ''} ${initiator.lastName || ''}`.trim() || initiator.username
      : null
  ) || 'Investigator';

  const candidateIds = [caseRecord.createdBy, caseRecord.assignedTo, userId].filter(Boolean);
  const participantIds = [...new Set(candidateIds)];

  const metadataJson = JSON.stringify({
    caseId: caseRecord.id,
    caseNumber: caseRecord.caseNumber,
    caseTitle: caseRecord.title,
    priority: caseRecord.priority,
    status: caseRecord.status,
    initiatedBy: userId,
    initiatedAt: new Date().toISOString()
  });

  conversation = await prisma.chatConversation.create({
    data: {
      tenantId,
      type: 'GROUP',
      title: `Case #${caseRecord.caseNumber}: ${caseRecord.title}`,
      description: metadataJson,
      createdBy: userId,
      participants: {
        create: participantIds.map(pId => ({
          userId: pId,
          role: pId === userId ? 'OWNER' : 'MEMBER'
        }))
      }
    }
  });

  const welcomeText = `📋 Case Collaboration Room initiated for Case #${caseRecord.caseNumber} (${caseRecord.title}) by ${initiatorName}.\nPriority: ${caseRecord.priority.toUpperCase()} · Status: ${caseRecord.status.toUpperCase()}`;

  const firstMsg = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      senderId: userId,
      tenantId,
      clientMessageId: `system-case-init-${caseRecord.id}-${Date.now()}`,
      content: welcomeText,
      messageType: 'SYSTEM'
    }
  });

  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageId: firstMsg.id,
      lastMessageAt: firstMsg.createdAt
    }
  });

  const fullConversation = await getConversationDetails(conversation.id);

  return {
    created: true,
    conversation: fullConversation,
    caseInfo: {
      id: caseRecord.id,
      caseNumber: caseRecord.caseNumber,
      title: caseRecord.title,
      status: caseRecord.status,
      priority: caseRecord.priority
    }
  };
}

export async function getReferralConversation({ tenantId, userId, referralId }) {
  if (!referralId) {
    throw new ValidationError('referralId is required');
  }

  const referral = await prisma.caseReferral.findFirst({
    where: {
      id: referralId,
      OR: [
        { fromTenantId: tenantId },
        { toTenantId: tenantId }
      ]
    },
    include: {
      case: {
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          priority: true,
          assignedTo: true,
        }
      },
      fromTenant: { select: { id: true, name: true, code: true } },
      toTenant: { select: { id: true, name: true, code: true } },
      fromDepartment: { select: { id: true, name: true, code: true } },
      toDepartment: { select: { id: true, name: true, code: true } },
      referrer: { select: { id: true, firstName: true, lastName: true, email: true, username: true } },
      accepter: { select: { id: true, firstName: true, lastName: true, email: true, username: true } }
    }
  });

  if (!referral) {
    throw new NotFoundError('Referral not found or access denied');
  }

  const conversation = await prisma.chatConversation.findFirst({
    where: {
      type: 'GROUP',
      description: {
        contains: `"referralId":"${referralId}"`
      },
      isArchived: false
    },
    include: {
      participants: {
        where: { leftAt: null },
        include: {
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
  });

  const referralInfo = {
    id: referral.id,
    caseId: referral.caseId,
    caseNumber: referral.case?.caseNumber || null,
    caseTitle: referral.case?.title || null,
    fromTenantId: referral.fromTenantId,
    toTenantId: referral.toTenantId,
    fromTenantCode: referral.fromTenant?.code || 'ORG',
    toTenantCode: referral.toTenant?.code || 'ORG',
    fromTenantName: referral.fromTenant?.name || 'Referring Agency',
    toTenantName: referral.toTenant?.name || 'Receiving Agency',
    fromDepartmentName: referral.fromDepartment?.name || null,
    toDepartmentName: referral.toDepartment?.name || null,
    status: referral.status,
    referredAt: referral.referredAt,
    acceptedAt: referral.acceptedAt,
  };

  if (!conversation) {
    return {
      exists: false,
      conversation: null,
      referralInfo
    };
  }

  const isParticipant = conversation.participants.some(p => p.userId === userId);

  return {
    exists: true,
    isParticipant,
    conversation,
    referralInfo
  };
}

export async function initiateReferralConversation({ tenantId, userId, referralId }) {
  if (!referralId) {
    throw new ValidationError('referralId is required');
  }

  const referral = await prisma.caseReferral.findFirst({
    where: {
      id: referralId,
      OR: [
        { fromTenantId: tenantId },
        { toTenantId: tenantId }
      ]
    },
    include: {
      case: {
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          priority: true,
          assignedTo: true,
          createdBy: true
        }
      },
      fromTenant: { select: { id: true, name: true, code: true } },
      toTenant: { select: { id: true, name: true, code: true } },
      fromDepartment: { select: { id: true, name: true, code: true } },
      toDepartment: { select: { id: true, name: true, code: true } },
      referrer: { select: { id: true, firstName: true, lastName: true, username: true } },
      accepter: { select: { id: true, firstName: true, lastName: true, username: true } }
    }
  });

  if (!referral) {
    throw new NotFoundError('Referral not found or access denied');
  }

  const referralInfo = {
    id: referral.id,
    caseId: referral.caseId,
    caseNumber: referral.case?.caseNumber || null,
    caseTitle: referral.case?.title || null,
    fromTenantId: referral.fromTenantId,
    toTenantId: referral.toTenantId,
    fromTenantCode: referral.fromTenant?.code || 'ORG',
    toTenantCode: referral.toTenant?.code || 'ORG',
    fromTenantName: referral.fromTenant?.name || 'Referring Agency',
    toTenantName: referral.toTenant?.name || 'Receiving Agency',
    fromDepartmentName: referral.fromDepartment?.name || null,
    toDepartmentName: referral.toDepartment?.name || null,
    status: referral.status,
    referredAt: referral.referredAt,
    acceptedAt: referral.acceptedAt,
  };

  let conversation = await prisma.chatConversation.findFirst({
    where: {
      type: 'GROUP',
      description: {
        contains: `"referralId":"${referralId}"`
      },
      isArchived: false
    },
    include: {
      participants: {
        where: { leftAt: null }
      }
    }
  });

  if (conversation) {
    const isMember = conversation.participants.some(p => p.userId === userId);
    if (!isMember) {
      await prisma.chatParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId
          }
        },
        create: {
          conversationId: conversation.id,
          userId,
          role: 'MEMBER'
        },
        update: {
          leftAt: null,
          role: 'MEMBER'
        }
      });
    }
    const fullConversation = await getConversationDetails(conversation.id);
    return {
      created: false,
      conversation: fullConversation,
      referralInfo
    };
  }

  const initiator = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, username: true }
  });
  const initiatorName = (
    initiator
      ? `${initiator.firstName || ''} ${initiator.lastName || ''}`.trim() || initiator.username
      : null
  ) || 'Officer';

  const candidateIds = [
    referral.referredBy,
    referral.acceptedBy,
    referral.case?.assignedTo,
    userId
  ].filter(Boolean);
  const participantIds = [...new Set(candidateIds)];

  const metadataJson = JSON.stringify({
    referralId: referral.id,
    caseId: referral.caseId,
    caseNumber: referral.case?.caseNumber || 'N/A',
    caseTitle: referral.case?.title || 'Referral Case',
    fromTenantId: referral.fromTenantId,
    toTenantId: referral.toTenantId,
    fromTenantCode: referral.fromTenant?.code || 'ORG',
    toTenantCode: referral.toTenant?.code || 'ORG',
    fromDepartmentName: referral.fromDepartment?.name || null,
    toDepartmentName: referral.toDepartment?.name || null,
    status: referral.status,
    initiatedBy: userId,
    initiatedAt: new Date().toISOString()
  });

  const fromCode = referral.fromTenant?.code || 'ORG';
  const toCode = referral.toTenant?.code || 'ORG';
  const roomTitle = `Referral: Case #${referral.case?.caseNumber || referral.caseId.slice(0, 8)} (${fromCode} → ${toCode})`;

  conversation = await prisma.chatConversation.create({
    data: {
      tenantId: referral.fromTenantId,
      type: 'GROUP',
      title: roomTitle,
      description: metadataJson,
      createdBy: userId,
      participants: {
        create: participantIds.map(pId => ({
          userId: pId,
          role: pId === userId ? 'OWNER' : 'MEMBER'
        }))
      }
    }
  });

  const welcomeText = `🤝 Inter-Agency Collaboration Room initiated for Referral on Case #${referral.case?.caseNumber || referral.caseId.slice(0, 8)} (${fromCode} → ${toCode}) by ${initiatorName}.\nReferral Status: ${referral.status.toUpperCase()}`;

  const firstMsg = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      senderId: userId,
      tenantId,
      clientMessageId: `system-referral-init-${referral.id}-${Date.now()}`,
      content: welcomeText,
      messageType: 'SYSTEM'
    }
  });

  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageId: firstMsg.id,
      lastMessageAt: firstMsg.createdAt
    }
  });

  const fullConversation = await getConversationDetails(conversation.id);

  return {
    created: true,
    conversation: fullConversation,
    referralInfo
  };
}


