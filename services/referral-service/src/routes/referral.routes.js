import express from 'express';
import {
  getReferrals,
  getReferral,
  createReferral,
  acceptReferral,
  assignReferral,
  rejectReferral,
  completeReferral,
} from '../controllers/referral.controller.js';
import { requireGatewayIdentity } from '../middleware/requireGatewayIdentity.js';

const router = express.Router();

router.use(requireGatewayIdentity);

router.get('/', getReferrals);
router.get('/:id', getReferral);
router.post('/', createReferral);
router.post('/:id/accept', acceptReferral);
router.post('/:id/assign', assignReferral);
router.post('/:id/reject', rejectReferral);
router.post('/:id/complete', completeReferral);

export default router;
