/**
 * oauth-providers.routes.js
 * Platform-admin routes for managing OAuthProvider configurations.
 * Mounted at /oauth/providers in server.js.
 */

import { Router } from 'express';
import {
  listProviders,
  createProvider,
  getProvider,
  updateProvider,
  deleteProvider,
} from '../controllers/oauth-providers.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', listProviders);
router.post('/', createProvider);
router.get('/:id', getProvider);
router.patch('/:id', updateProvider);
router.delete('/:id', deleteProvider);

export default router;

