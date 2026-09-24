import express from 'express';
import { attachActor } from '../../middleware/actor.js';
import { requireParticipant } from '../../middleware/conversation.auth.js';
import * as conversationController from './conversation.controller.js';

const router = express.Router();

router.use(attachActor);

// List user's conversations
router.get('/', conversationController.listConversations);

// Create a DIRECT or GROUP conversation
router.post('/', conversationController.createConversation);

// Get a single conversation with participants
router.get('/:id', requireParticipant, conversationController.getConversation);

// Update GROUP metadata
router.patch('/:id', requireParticipant, conversationController.updateConversation);

// Archive conversation
router.delete('/:id', requireParticipant, conversationController.archiveConversation);

export default router;
