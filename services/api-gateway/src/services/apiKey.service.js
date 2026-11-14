import crypto from 'node:crypto';
import { AppError, UnauthorizedError } from '../../../../shared/common/errors.js';

const IAM_TIMEOUT_MS = Number(process.env.IAM_API_TIMEOUT_MS || 5000);

function iamBaseUrl() {
  return (process.env.IAM_SERVICE_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/$/, '');
}

async function callIam(path, { method = 'GET', body, tenantId, userId } = {}) {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new AppError('IAM service credentials are not configured', 503, 'IAM_UNAVAILABLE');
  }

  const headers = {
    'x-internal-service-token': internalToken,
    accept: 'application/json',
  };
  if (tenantId) headers['x-tenant-id'] = String(tenantId);
  if (userId) headers['x-user-id'] = String(userId);
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${iamBaseUrl()}/api-keys${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(IAM_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('IAM service is unavailable for API key operations', 503, 'IAM_UNAVAILABLE');
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Keep the gateway response stable if IAM returns an empty or non-JSON body.
  }

  if (response.ok) return payload;

  const message = payload?.error?.message || payload?.message || 'IAM API key operation failed';
  if (response.status === 401) throw new UnauthorizedError(message);
  if (response.status === 404) throw new Error('API key not found');
  if (response.status >= 500) {
    throw new AppError('IAM service failed while handling an API key operation', 503, 'IAM_UNAVAILABLE');
  }
  throw new AppError(message, response.status, payload?.error?.code || 'IAM_API_KEY_ERROR');
}

function actorContext(tenantId, userId) {
  return { tenantId, userId };
}

/** Create the API key through IAM, which owns its hash and lifecycle. */
export async function generateApiKey(tenantId, name, scopes, expiresAt, createdBy) {
  const payload = await callIam('', {
    method: 'POST',
    ...actorContext(tenantId, createdBy),
    body: { name, scopes, expiresAt: expiresAt ?? null },
  });
  const apiKey = payload.apiKey;
  return {
    rawKey: payload.rawKey,
    keyId: apiKey.id,
    keyPrefix: apiKey.keyPrefix,
    name: apiKey.name,
    scopes: apiKey.scopes,
  };
}

/** Validate a presented key without sending the raw secret outside the gateway. */
export async function validateApiKey(rawKey, ip) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const payload = await callIam('/validate', {
    method: 'POST',
    body: { keyHash, ip },
  });
  const apiKey = payload.apiKey;
  return {
    tenantId: apiKey.tenantId,
    scopes: apiKey.scopes,
    keyId: apiKey.id,
    keyName: apiKey.name,
    tenantCode: apiKey.tenantCode,
    createdBy: apiKey.createdBy,
  };
}

/** Resolve key-owner context for older OAuth API-key tokens during rollout. */
export async function resolveApiKeyOwner(apiKeyId, tenantId) {
  const payload = await callIam('/internal/resolve-owner', {
    method: 'POST',
    body: { apiKeyId, tenantId },
  });
  return payload.apiKeyContext?.createdBy ?? null;
}

/** Revoke a key through IAM. */
export async function revokeApiKey(keyId, tenantId, revokedBy) {
  return callIam(`/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    ...actorContext(tenantId, revokedBy),
  });
}

/** Rotate a key through IAM and preserve the gateway's one-time secret response. */
export async function rotateApiKey(keyId, tenantId, rotatedBy) {
  const payload = await callIam(`/${encodeURIComponent(keyId)}/rotate`, {
    method: 'POST',
    ...actorContext(tenantId, rotatedBy),
  });
  const apiKey = payload.apiKey;
  return {
    rawKey: payload.rawKey,
    keyId: apiKey.id,
    keyPrefix: apiKey.keyPrefix,
    name: apiKey.name,
    scopes: apiKey.scopes,
  };
}

/** List tenant keys through IAM while preserving the gateway's existing response shape. */
export async function listApiKeys(tenantId, requestedBy) {
  const payload = await callIam('', {
    ...actorContext(tenantId, requestedBy),
  });
  return (payload.apiKeys || []).map(({ id, name, keyPrefix, scopes, isActive, expiresAt, lastUsedAt, createdAt, revokedAt }) => ({
    id,
    name,
    keyPrefix,
    scopes,
    isActive,
    expiresAt,
    lastUsedAt,
    createdAt,
    revokedAt,
  }));
}
