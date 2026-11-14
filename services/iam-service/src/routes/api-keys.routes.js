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
  getScopes,
  validateApiKeyInternal,
  resolveApiKeyOwnerInternal,
} from '../controllers/api-keys.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireInternalRequest } from '#iam/iamRequireInternalRequest.js';

const router = Router();

// Service-to-service endpoints are protected by the internal token and must be
// registered before the human-session middleware below.
const requireGatewayToken = requireInternalRequest({ skipPaths: [] });
router.post('/validate', requireGatewayToken, validateApiKeyInternal);
router.post('/internal/resolve-owner', requireGatewayToken, resolveApiKeyOwnerInternal);

router.use(authenticateToken);

router.get('/scopes', getScopes);
router.get('/', listApiKeys);
router.post('/', createApiKey);
router.get('/:id', getApiKey);
router.post('/:id/rotate', rotateApiKey);
router.post('/:id/revoke', revokeApiKey);
router.delete('/:id', revokeApiKey);

export default router;
