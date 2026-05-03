import express from 'express';
import {
  transitionCase,
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflowStates,
  createWorkflowState,
} from '../controllers/workflow.controller.js';

const router = express.Router();

router.post('/cases/:caseId/transition', transitionCase);
router.post('/states', createWorkflowState);

router.get('/', getWorkflows);
router.get('/:id/states', getWorkflowStates);
router.get('/:id', getWorkflow);
router.post('/', createWorkflow);
router.put('/:id', updateWorkflow);
router.delete('/:id', deleteWorkflow);

export default router;
