import express from 'express';
import {
  getWorkflows,
  getPublishedWorkflow,
  getWorkflowFull,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  publishWorkflow,
  newWorkflowVersion,
  archiveWorkflow,
} from '../controllers/workflow.controller.js';
import { createStep, updateStep, deleteStep } from '../controllers/step.controller.js';
import { createTransition, deleteTransition } from '../controllers/transition.controller.js';

const router = express.Router();

router.get('/', getWorkflows);
router.get('/published', getPublishedWorkflow);
router.post('/', createWorkflow);

router.post('/:id/publish', publishWorkflow);
router.post('/:id/new-version', newWorkflowVersion);
router.post('/:id/archive', archiveWorkflow);

router.get('/:id/full', getWorkflowFull);
router.get('/:id', getWorkflow);
router.put('/:id', updateWorkflow);
router.delete('/:id', deleteWorkflow);

router.post('/:id/steps', createStep);
router.put('/:id/steps/:stepId', updateStep);
router.delete('/:id/steps/:stepId', deleteStep);

router.post('/:id/transitions', createTransition);
router.delete('/:id/transitions/:transitionId', deleteTransition);

export default router;
