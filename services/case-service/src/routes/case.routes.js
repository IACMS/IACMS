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
import { getCases, getCase, createCase, updateCase, deleteCase } from '../controllers/case.controller.js';
import { getCaseState } from '../controllers/state.controller.js';
import { httpExecuteTransition } from '../services/transition.engine.js';

const router = express.Router();

router.get('/', getCases);
router.post('/', createCase);

router.post('/:id/transitions/:transitionId/execute', httpExecuteTransition);
router.get('/:id/state', getCaseState);

router.get('/:id', getCase);
router.put('/:id', updateCase);
router.delete('/:id', deleteCase);

router.post('/:id/transitions/:transitionId/execute', executeTransition);
router.get('/:id/history', getCaseHistory);
router.get('/:id/state', getCaseState);

export default router;
