import express from 'express';
import {
  getCases,
  getCase,
  createCase,
  updateCase,
  deleteCase,
  executeTransition,
  getCaseHistory,
  getCaseState
} from '../controllers/case.controller.js';

const router = express.Router();

router.get('/', getCases);
router.get('/:id', getCase);
router.post('/', createCase);
router.put('/:id', updateCase);
router.delete('/:id', deleteCase);

router.post('/:id/transitions/:transitionId/execute', executeTransition);
router.get('/:id/history', getCaseHistory);
router.get('/:id/state', getCaseState);

export default router;
