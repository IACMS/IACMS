/**
 * api-key.grant.js
 * Implements the custom OAuth2 grant type: urn:iacms:grant:api_key
 *
 * Allows services and scripts to exchange a long-lived opaque API key
 * for a short-lived RS256 JWT access token (RFC 6749 extension).
 *
 * Features:
 *  - Rate limiting: 5 token requests/second per key.
 *  - SHA-256 key hash lookup.
 *  - Tenant isolation and active checks.
 *  - Embeds tenant_id, tenant_code, api_key_id, and scopes into the JWT.
 *  - Kafka audit log on token exchange.
 */

import crypto from 'crypto';
import prisma from '../../config/database.js';
import Logger from '../../../../../shared/common/logger.js';
import { getEventBus } from '../../utils/auth.helpers.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';

const logger = new Logger('iam-api-key-grant');

export const GRANT_TYPE = 'urn:iacms:grant:api_key';
export const PARAMETERS = ['api_key', 'scope', 'resource'];

export function _resetRateLimits() {
  rateLimits.clear();
}
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second
const MAX_REQUESTS_PER_SECOND = 5;

function checkRateLimit(keyPrefix) {
  const now = Date.now();
  const entry = rateLimits.get(keyPrefix);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(keyPrefix, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS_PER_SECOND) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Custom grant handler registered with node-oidc-provider.
 *
 * @param {import('oidc-provider').KoaContextWithOIDC} ctx
 */
export async function apiKeyGrantHandler(ctx) {
  const { params, client } = ctx.oidc;
  const rawKey = params.api_key;

  if (!rawKey || typeof rawKey !== 'string') {
    ctx.status = 400;
    ctx.body = {
      error: 'invalid_request',
      error_description: 'api_key parameter is required for urn:iacms:grant:api_key',
    };
    return;
  }

  const keyPrefix = rawKey.substring(0, 20);

  // 1. Rate limiting (5 token requests/sec per key)
  if (!checkRateLimit(keyPrefix)) {
    logger.warn('API key token rate limit exceeded', { keyPrefix });
    ctx.status = 429;
    ctx.body = {
      error: 'slow_down',
      error_description: 'Rate limit exceeded: maximum 5 token requests per second per API key',
    };
    return;
  }

  // 2. Hash key via SHA-256
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  // 3. Lookup API key in database
  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { tenant: true },
  });

  if (!apiKeyRecord || !apiKeyRecord.isActive) {
    logger.warn('API key exchange failed: invalid or inactive key', { keyPrefix });
    ctx.status = 400;
    ctx.body = {
      error: 'invalid_grant',
      error_description: 'Invalid or inactive API key',
    };
    return;
  }

  if (apiKeyRecord.revokedAt) {
    logger.warn('API key exchange failed: key revoked', { keyPrefix, apiKeyId: apiKeyRecord.id });
    ctx.status = 400;
    ctx.body = {
      error: 'invalid_grant',
      error_description: 'API key has been revoked',
    };
    return;
  }

  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    logger.warn('API key exchange failed: key expired', { keyPrefix, apiKeyId: apiKeyRecord.id });
    ctx.status = 400;
    ctx.body = {
      error: 'invalid_grant',
      error_description: 'API key has expired',
    };
    return;
  }

  if (!apiKeyRecord.tenant?.isActive) {
    logger.warn('API key exchange failed: tenant inactive', { tenantId: apiKeyRecord.tenantId });
    ctx.status = 400;
    ctx.body = {
      error: 'invalid_grant',
      error_description: 'Tenant organization is inactive',
    };
    return;
  }

  // Tenant isolation check: if client is tenant-scoped, must match API key's tenant
  const clientTenantId = client[Symbol.for('tenant_id')] ?? null;
  if (clientTenantId && clientTenantId !== apiKeyRecord.tenantId) {
    logger.warn('API key tenant mismatch with client', { clientTenantId, keyTenantId: apiKeyRecord.tenantId });
    ctx.status = 400;
    ctx.body = {
      error: 'invalid_grant',
      error_description: 'API key does not belong to the authorized organization for this client',
    };
    return;
  }

  // 4. Update last used metadata (non-blocking)
  prisma.apiKey
    .update({
      where: { id: apiKeyRecord.id },
      data: {
        lastUsedAt: new Date(),
        lastUsedIp: ctx.ip || ctx.request?.ip || null,
      },
    })
    .catch((err) => logger.warn('Failed to update apiKey lastUsed', { error: err.message }));

  // 5. Calculate granted scopes
  const keyScopes = Array.isArray(apiKeyRecord.scopes) ? apiKeyRecord.scopes : [];
  let grantedScopes = keyScopes;

  if (params.scope) {
    const requested = params.scope.split(' ');
    // Intersect requested scopes with scopes permitted for this API key
    grantedScopes = requested.filter((s) => keyScopes.includes(s));
  }

  // Always ensure 'api_key' scope is present
  if (!grantedScopes.includes('api_key')) {
    grantedScopes = ['api_key', ...grantedScopes];
  }

  // 6. Issue short-lived Access Token (JWT format, 1h TTL)
  const { AccessToken } = ctx.oidc.provider;
  const token = new AccessToken({
    client,
    scope: grantedScopes.join(' '),
  });

  // Attach custom attributes that oidc.config customizers.jwt will embed
  token.set('tenant_id', apiKeyRecord.tenantId);
  token.set('tenant_code', apiKeyRecord.tenant.code);
  token.set('api_key_id', apiKeyRecord.id);
  token.set('roles', ['api_key']);

  const tokenValue = await token.save();

  logger.info('M2M API key token issued', {
    apiKeyId: apiKeyRecord.id,
    tenantId: apiKeyRecord.tenantId,
    clientId: client.clientId,
  });

  // 7. Audit log via EventBus
  const bus = getEventBus();
  if (bus) {
    bus.publish(TOPICS.AUDIT_LOG, {
      tenantId: apiKeyRecord.tenantId,
      entityType: 'api_key',
      entityId: apiKeyRecord.id,
      action: 'api_key.token_issued',
      userId: null,
      metadata: {
        keyPrefix: apiKeyRecord.keyPrefix,
        clientId: client.clientId,
        ip: ctx.ip,
      },
    }).catch(() => {});
  }

  ctx.status = 200;
  ctx.body = {
    access_token: tokenValue,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: token.scope,
  };
}
