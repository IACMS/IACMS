import express from 'express';
import {
  getWorkflows,
  getWorkflow,
  getFullWorkflow,
  getPublishedWorkflow,
  createWorkflow,
  updateWorkflow,
  addStep,
  updateStep,
  deleteStep,
  addTransition,
  deleteTransition,
  publishWorkflow
} from '../controllers/workflow.controller.js';

const router = express.Router();

router.get('/published', getPublishedWorkflow); // Note: /published must come before /:id
router.get('/', getWorkflows);
router.get('/:id', getWorkflow);
router.get('/:id/full', getFullWorkflow);
router.post('/', createWorkflow);
router.put('/:id', updateWorkflow);

router.post('/:id/steps', addStep);
router.put('/:id/steps/:stepId', updateStep);
router.delete('/:id/steps/:stepId', deleteStep);

router.post('/:id/transitions', addTransition);
router.delete('/:id/transitions/:transitionId', deleteTransition);

router.post('/:id/publish', publishWorkflow);

export default router;
