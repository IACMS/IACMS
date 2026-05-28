import express from 'express';
import {
  getReferrals,
  getReferral,
  createReferral,
  acceptReferral,
  rejectReferral,
  completeReferral,
} from '../controllers/referral.controller.js';

const router = express.Router();

router.get('/', getReferrals);
router.get('/:id', getReferral);
router.post('/', createReferral);
router.post('/:id/accept', acceptReferral);
router.post('/:id/reject', rejectReferral);
router.post('/:id/complete', completeReferral);

export default router;
