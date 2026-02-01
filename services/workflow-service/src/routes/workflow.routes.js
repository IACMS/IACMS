import express from 'express';
import {
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflowStates,
  createWorkflowState,
} from '../controllers/workflow.controller.js';

const router = express.Router();

router.get('/', getWorkflows);
router.get('/:id', getWorkflow);
router.post('/', createWorkflow);
router.put('/:id', updateWorkflow);
router.delete('/:id', deleteWorkflow);

router.get('/:id/states', getWorkflowStates);
router.post('/states', createWorkflowState);

export default router;
