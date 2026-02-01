import express from 'express';
import {
  getWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
} from '../controllers/webhook.controller.js';

const router = express.Router();

router.get('/', getWebhooks);
router.get('/:id', getWebhook);
router.post('/', createWebhook);
router.put('/:id', updateWebhook);
router.delete('/:id', deleteWebhook);
router.post('/:id/test', testWebhook);

export default router;
