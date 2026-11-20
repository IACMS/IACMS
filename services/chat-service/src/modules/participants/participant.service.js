import prisma from '../../config/database.js';
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../../../../../shared/common/errors.js';

/**
 * List active participants of a conversation with user details.
 */
export async function listParticipants({ conversationId }) {
  return prisma.chatParticipant.findMany({
    where: {
      conversationId,
      leftAt: null,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          email: true,
          isActive: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
}

/**
 * Add a member to a GROUP conversation.
 * Only ADMIN or OWNER can add members.
 */
export async function addParticipant({ conversationId, actorParticipant, userId }) {
  if (actorParticipant.conversation.type !== 'GROUP') {
    throw new ValidationError('Cannot add members to a DIRECT conversation');
  }

  if (actorParticipant.role === 'MEMBER') {
    throw new ForbiddenError('Only ADMIN or OWNER can add members');
  }

  // Check if user is already a participant
  const existing = await prisma.chatParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });

  if (existing && !existing.leftAt) {
    throw new ValidationError('User is already an active member of this conversation');
  }

  // If they were previously removed, re-join them
  if (existing && existing.leftAt) {
    return prisma.chatParticipant.update({
      where: { id: existing.id },
      data: {
        leftAt: null,
        role: 'MEMBER',
        isArchived: false,
        isMuted: false,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, username: true },
        },
      },
    });
  }

  // Verify user exists and belongs to the same tenant
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId: actorParticipant.conversation.tenantId,
      isActive: true,
    },
  });

  if (!user) {
    throw new NotFoundError('User not found or not in the same tenant');
  }

  // Create system message for the join event
  const result = await prisma.$transaction(async (tx) => {
    const participant = await tx.chatParticipant.create({
      data: {
        conversationId,
        userId,
        role: 'MEMBER',
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, username: true },
        },
      },
    });

    // System message: "User joined the group"
    await tx.chatMessage.create({
      data: {
        conversationId,
        tenantId: actorParticipant.conversation.tenantId,
        senderId: userId,
        clientMessageId: `system-join-${userId}-${Date.now()}`,
        messageType: 'SYSTEM',
        content: `${user.firstName} ${user.lastName} was added to the group`,
      },
    });

    return participant;
  });

  return result;
}

/**
 * Remove a member from a GROUP conversation.
 * OWNER can remove anyone. ADMIN can remove MEMBERs.
 * A member can remove themselves (leave).
 */
export async function removeParticipant({ conversationId, actorParticipant, targetUserId }) {
  if (actorParticipant.conversation.type !== 'GROUP') {
    throw new ValidationError('Cannot remove members from a DIRECT conversation');
  }

  const isSelf = actorParticipant.userId === targetUserId;
  const isOwner = actorParticipant.role === 'OWNER';
  const isAdmin = actorParticipant.role === 'ADMIN';

  if (!isSelf && !isOwner && !isAdmin) {
    throw new ForbiddenError('Insufficient permissions to remove members');
  }

  const target = await prisma.chatParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId: targetUserId },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!target || target.leftAt) {
    throw new NotFoundError('User is not an active member of this conversation');
  }

  // Admins cannot remove other admins or the owner
  if (isAdmin && !isSelf && ['ADMIN', 'OWNER'].includes(target.role)) {
    throw new ForbiddenError('Admins cannot remove other admins or the owner');
  }

  // Owner cannot leave (must transfer ownership first)
  if (isSelf && isOwner) {
    throw new ValidationError('Owner cannot leave the group. Transfer ownership first.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.chatParticipant.update({
      where: { id: target.id },
      data: { leftAt: new Date() },
    });

    const action = isSelf ? 'left the group' : 'was removed from the group';
    await tx.chatMessage.create({
      data: {
        conversationId,
        tenantId: actorParticipant.conversation.tenantId,
        senderId: targetUserId,
        clientMessageId: `system-leave-${targetUserId}-${Date.now()}`,
        messageType: 'SYSTEM',
        content: `${target.user.firstName} ${target.user.lastName} ${action}`,
      },
    });
  });
}

/**
 * Update a participant's role (promote/demote).
 * Only the OWNER can change roles.
 */
export async function updateParticipantRole({ conversationId, actorParticipant, targetUserId, newRole }) {
  if (actorParticipant.role !== 'OWNER') {
    throw new ForbiddenError('Only the group owner can change member roles');
  }

  if (!['MEMBER', 'ADMIN'].includes(newRole)) {
    throw new ValidationError('Role must be MEMBER or ADMIN');
  }

  const target = await prisma.chatParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId: targetUserId },
    },
  });

  if (!target || target.leftAt) {
    throw new NotFoundError('User is not an active member');
  }

  if (target.role === 'OWNER') {
    throw new ValidationError('Cannot change the owner role. Use ownership transfer instead.');
  }

  return prisma.chatParticipant.update({
    where: { id: target.id },
    data: { role: newRole },
  });
}

/**
 * Toggle mute for the calling user in a conversation.
 */
export async function toggleMute({ conversationId, userId, muted }) {
  const participant = await prisma.chatParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });

  if (!participant || participant.leftAt) {
    throw new NotFoundError('Not an active member');
  }

  return prisma.chatParticipant.update({
    where: { id: participant.id },
    data: { isMuted: muted },
  });
}
