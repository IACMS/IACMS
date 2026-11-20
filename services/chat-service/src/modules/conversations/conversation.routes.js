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

// Case-linked collaboration rooms (Must be defined before /:id)
router.get('/case/:caseId', conversationController.getCaseConversation);
router.post('/case/:caseId', conversationController.initiateCaseConversation);

// Referral-linked collaboration rooms (Must be defined before /:id)
router.get('/referral/:referralId', conversationController.getReferralConversation);
router.post('/referral/:referralId', conversationController.initiateReferralConversation);

// Get a single conversation with participants
router.get('/:id', requireParticipant, conversationController.getConversation);

// Update GROUP metadata
router.patch('/:id', requireParticipant, conversationController.updateConversation);

// Delete or archive conversation
router.delete('/:id', requireParticipant, conversationController.deleteConversation);

// Pinned message
router.get('/:id/pinned', requireParticipant, conversationController.getPinnedMessage);
router.post('/:id/pin/:messageId', requireParticipant, conversationController.pinMessage);
router.delete('/:id/pin', requireParticipant, conversationController.unpinMessage);

export default router;
