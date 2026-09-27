import express from 'express';
import { attachActor } from '../../middleware/actor.js';
import { requireParticipant } from '../../middleware/conversation.auth.js';
import * as participantController from './participant.controller.js';

const router = express.Router({ mergeParams: true });

router.use(attachActor);
router.use(requireParticipant);

router.get('/', participantController.listParticipants);
router.post('/', participantController.addParticipant);
router.delete('/:userId', participantController.removeParticipant);
router.patch('/:userId/role', participantController.updateRole);

// Mute/unmute (applies to the calling user only)
router.post('/mute', participantController.toggleMute);

export default router;
