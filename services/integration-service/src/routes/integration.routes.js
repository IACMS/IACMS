import express from 'express';
import {
  getIntegrations,
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  syncIntegration,
} from '../controllers/integration.controller.js';

const router = express.Router();

router.get('/', getIntegrations);
router.get('/:id', getIntegration);
router.post('/', createIntegration);
router.put('/:id', updateIntegration);
router.delete('/:id', deleteIntegration);
router.post('/:id/sync', syncIntegration);

export default router;
