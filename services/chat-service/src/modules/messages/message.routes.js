import express from 'express';
import { attachActor } from '../../middleware/actor.js';
import { requireParticipant } from '../../middleware/conversation.auth.js';
import * as messageController from './message.controller.js';

const router = express.Router({ mergeParams: true });

// All message routes require actor identity + active conversation membership
router.use(attachActor);
router.use(requireParticipant);

// Messages CRUD
router.get('/', messageController.listMessages);
router.post('/', messageController.sendMessage);
router.patch('/:messageId', messageController.editMessage);
router.delete('/:messageId', messageController.deleteMessage);

// Reactions
router.post('/:messageId/reactions', messageController.addReaction);
router.delete('/:messageId/reactions/:emoji', messageController.removeReaction);

// Read receipts
router.post('/read', messageController.markAsRead);

export default router;
