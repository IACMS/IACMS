/**
 * oauth-clients.routes.js
 * Platform-admin routes for managing OAuth2 clients.
 * Mounted at /oauth/clients in server.js.
 */

import { Router } from 'express';
import {
  listClients,
  createClient,
  getClient,
  updateClient,
  rotateClientSecret,
  deleteClient,
} from '../controllers/oauth-clients.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/',           listClients);
router.post('/',          createClient);
router.get('/:id',        getClient);
router.patch('/:id',      updateClient);
router.post('/:id/rotate-secret', rotateClientSecret);
router.delete('/:id',     deleteClient);

export default router;
