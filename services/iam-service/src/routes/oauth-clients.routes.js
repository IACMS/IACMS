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
  listClientUsers,
  assignClientUserRole,
  unassignClientUserRole,
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

// Per-application role and user assignment
router.get('/:id/users',                                listClientUsers);
router.post('/:id/users',                               assignClientUserRole);
router.delete('/:id/users/:userId/roles/:roleId',       unassignClientUserRole);

export default router;
