/**
 * api-keys.routes.js
 * Tenant-scoped routes for partner API key management.
 * Mounted at /api-keys in server.js.
 */

import { Router } from 'express';
import {
  createApiKey,
  listApiKeys,
  getApiKey,
  rotateApiKey,
  revokeApiKey,
} from '../controllers/api-keys.controller.js';

const router = Router();

router.get('/', listApiKeys);
router.post('/', createApiKey);
router.get('/:id', getApiKey);
router.post('/:id/rotate', rotateApiKey);
router.post('/:id/revoke', revokeApiKey);
router.delete('/:id', revokeApiKey);

export default router;
