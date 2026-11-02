/**
 * social.routes.js
 * Social authentication and federated identity routes.
 * Mounted at /auth/social in server.js.
 */

import { Router } from 'express';
import {
  initiateAuth,
  handleCallback,
  linkProvider,
  unlinkProvider,
  getLinkedProviders,
  getAvailableProviders,
} from './social.controller.js';

const router = Router();

// Public metadata
router.get('/providers', getAvailableProviders);

// Authenticated user identity management (can authenticate via JWT or internal gateway headers)
router.get('/identities', getLinkedProviders);

// Public authorization entrypoint
router.get('/:provider', initiateAuth);

// Public OAuth callbacks (GET & POST for form_post mode)
router.get('/:provider/callback', handleCallback);
router.post('/:provider/callback', handleCallback);

// Authenticated linking / unlinking
router.post('/:provider/link', linkProvider);
router.delete('/:provider', unlinkProvider);

export default router;

