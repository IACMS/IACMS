import express from 'express';
import { generateApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '../services/apiKey.service.js';
import { ForbiddenError, ValidationError } from '../../../../shared/common/errors.js';
import allowlistRegistry from '../engine/allowlists/index.js';
import mutationRegistry from '../engine/mutations/index.js';

const router = express.Router();

/**
 * Derive VALID_SCOPES dynamically from the two sources of truth:
 *   1. Allowlist registry → each entity contributes a "<entity>:read" scope.
 *   2. Mutation registry  → each mutation's requiredScope is included directly.
 *
 * This means adding a new entity/mutation automatically makes its scope
 * assignable to API keys without any manual update here.
 */
function buildValidScopes() {
  const scopes = new Set(['*']);
  for (const [entity] of allowlistRegistry) {
    scopes.add(`${entity}:read`);
  }
  for (const [, mutation] of mutationRegistry) {
    if (mutation.requiredScope) scopes.add(mutation.requiredScope);
  }
  return scopes;
}

const VALID_SCOPES = buildValidScopes();

/**
 * Middleware: ensure the caller is an authenticated human user (not an API key itself).
 * API key management is session/JWT-only — API keys cannot create other API keys.
 */
function requireHumanSession(req, res, next) {
  if (req.apiKeyContext) {
    return next(new ForbiddenError('API key management requires a user session, not an API key.'));
  }
  if (!req.user) {
    return next(new ForbiddenError('Authentication required.'));
  }
  next();
}

function errorResponse(res, statusCode, code, message) {
  return res.status(statusCode).json({ error: { code, message } });
}

// GET /api/v1/api-keys/scopes — list all assignable scopes
// Must be defined before /:id routes to avoid being captured as an id param.
router.get('/scopes', requireHumanSession, (_req, res) => {
  return res.json({ scopes: [...VALID_SCOPES] });
});

// POST /api/v1/api-keys — create a new API key
router.post('/', requireHumanSession, async (req, res, next) => {
  try {
    const { name, scopes, expiresAt } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'API key name is required.');
    }
    if (name.trim().length > 128) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'API key name must be 128 characters or fewer.');
    }
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'At least one scope is required.');
    }
    const invalidScopes = scopes.filter(s => !VALID_SCOPES.has(s));
    if (invalidScopes.length > 0) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${[...VALID_SCOPES].join(', ')}`);
    }
    if (expiresAt != null) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime()) || d <= new Date()) {
        return errorResponse(res, 400, 'VALIDATION_ERROR', 'expiresAt must be a valid future ISO 8601 date.');
      }
    }

    const tenantId = req.user.tenantId;
    const createdBy = req.user.id;

    const result = await generateApiKey(tenantId, name.trim(), scopes, expiresAt ?? null, createdBy);

    return res.status(201).json({
      apiKey: {
        id: result.keyId,
        name: name.trim(),
        keyPrefix: result.keyPrefix,
        rawKey: result.rawKey,
        scopes,
        expiresAt: expiresAt ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/api-keys — list all API keys for the caller's tenant
router.get('/', requireHumanSession, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const apiKeys = await listApiKeys(tenantId);
    return res.json({ apiKeys });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/api-keys/:id — revoke a key
router.delete('/:id', requireHumanSession, async (req, res, next) => {
  try {
    const keyId = req.params.id;
    const tenantId = req.user.tenantId;
    const revokedBy = req.user.id;

    await revokeApiKey(keyId, tenantId, revokedBy);
    return res.json({ success: true, message: 'API key revoked successfully.' });
  } catch (error) {
    if (error.message === 'API key not found') {
      return errorResponse(res, 404, 'NOT_FOUND', 'API key not found or does not belong to your tenant.');
    }
    next(error);
  }
});

// POST /api/v1/api-keys/:id/rotate — rotate a key (revoke + reissue)
router.post('/:id/rotate', requireHumanSession, async (req, res, next) => {
  try {
    const keyId = req.params.id;
    const tenantId = req.user.tenantId;
    const rotatedBy = req.user.id;

    const result = await rotateApiKey(keyId, tenantId, rotatedBy);

    return res.status(200).json({
      apiKey: {
        id: result.keyId,
        name: result.name,
        keyPrefix: result.keyPrefix,
        rawKey: result.rawKey,
        scopes: result.scopes,
      },
    });
  } catch (error) {
    if (error.message === 'API key not found') {
      return errorResponse(res, 404, 'NOT_FOUND', 'API key not found or does not belong to your tenant.');
    }
    next(error);
  }
});

export default router;
