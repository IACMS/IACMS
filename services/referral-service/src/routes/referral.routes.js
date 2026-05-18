import express from 'express';
import {
  getReferrals,
  getReferral,
  createReferral,
  acceptReferral,
  rejectReferral,
} from '../controllers/referral.controller.js';
import { requireGatewayIdentity } from '../middleware/requireGatewayIdentity.js';

const router = express.Router();

router.use(requireGatewayIdentity);

router.get('/', getReferrals);
router.get('/:id', getReferral);
router.post('/', createReferral);
router.post('/:id/accept', acceptReferral);
router.post('/:id/reject', rejectReferral);

export default router;
