import prisma from '../config/database.js';
import { ForbiddenError, NotFoundError } from '../../../../shared/common/errors.js';
import { actorFromHeaders } from './actor.js';

/**
 * Validates that the current user is a participant in the specified conversation.
 */
export async function requireParticipant(req, res, next) {
  try {
    const { userId, tenantId } = actorFromHeaders(req);
    const conversationId = req.params.id || req.params.conversationId;

    if (!conversationId) {
      throw new Error('Conversation ID is missing in route params');
    }

    // Verify conversation belongs to tenant or is an authorized cross-tenant referral room
    const participant = await prisma.chatParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
        conversation: {
          OR: [
            { tenantId },
            { description: { contains: '"referralId"' } }
          ]
        }
      },
      include: {
        conversation: true
      }
    });

    if (!participant) {
      throw new ForbiddenError('Not an active member of this conversation');
    }

    req.participant = participant;
    req.conversation = participant.conversation;
    next();
  } catch (error) {
    next(error);
  }
}
