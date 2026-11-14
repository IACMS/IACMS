/**
 * api-keys.controller.js
 * Tenant-scoped CRUD and rotation for M2M partner API keys.
 * Routes: /api-keys
 */

import crypto from 'crypto';
import prisma from '../config/database.js';
import { ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '#iam/iamErrors.js';
import Logger from '#iam/iamLogger.js';
import { getEventBus } from '../utils/auth.helpers.js';
import { TOPICS } from '#iam/iamEventBus.js';

const logger = new Logger('iam-api-keys');

function getCallerContext(req) {
  const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];
  const userId = req.user?.id || req.headers['x-user-id'];

  if (!tenantId) {
    throw new ForbiddenError('Tenant context required to manage API keys');
  }
  if (!userId) {
    throw new ForbiddenError('User authentication required to manage API keys');
  }

  return { tenantId, userId };
}

const DEFAULT_API_KEY_SCOPES = [
  '*',
  'api:read',
  'api:write',
  'cases:read',
  'cases:create',
  'cases:update',
  'cases:write',
  'referrals:read',
  'referrals:create',
  'workflows:read',
  'workflows:update',
  'assignments:read',
  'auditLogs:read',
  'departments:read',
  'metrics:read',
];
export const AVAILABLE_SCOPES = (process.env.IAM_API_KEY_SCOPES || DEFAULT_API_KEY_SCOPES.join(','))
  .split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
const API_KEY_PREFIX = process.env.IAM_API_KEY_PREFIX || 'iacms_live_';

function validateRequestedScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
    throw new ValidationError('scopes must be an array of strings');
  }
  const unknown = scopes.filter((scope) => !AVAILABLE_SCOPES.includes(scope));
  if (unknown.length) throw new ValidationError(`Unsupported API key scope: ${unknown.join(', ')}`);
}

export async function getScopes(req, res, next) {
  try {
    res.json({ scopes: AVAILABLE_SCOPES });
  } catch (err) {
    next(err);
  }
}

/**
 * Internal gateway validation endpoint. The gateway sends only the SHA-256
 * verifier, never the presented raw API key. Route-level internal-token
 * middleware is applied in api-keys.routes.js.
 */
export async function validateApiKeyInternal(req, res, next) {
  try {
    const { keyHash, ip } = req.body ?? {};
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHash)) {
      throw new ValidationError('A SHA-256 API key hash is required');
    }

    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { tenant: { select: { isActive: true, code: true } } },
    });
    if (!apiKey) throw new UnauthorizedError('Invalid API key');
    if (!apiKey.isActive || apiKey.revokedAt) throw new UnauthorizedError('API key is revoked or inactive');
    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) throw new UnauthorizedError('API key has expired');
    if (!apiKey.tenant?.isActive) throw new UnauthorizedError('Tenant is inactive');

    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date(), lastUsedIp: typeof ip === 'string' ? ip.slice(0, 64) : null },
    }).catch((error) => logger.warn('Failed to update API key last usage', { apiKeyId: apiKey.id, error: error.message }));

    res.json({
      apiKey: {
        id: apiKey.id,
        tenantId: apiKey.tenantId,
        tenantCode: apiKey.tenant.code,
        name: apiKey.name,
        scopes: apiKey.scopes,
        createdBy: apiKey.createdBy,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** Internal compatibility endpoint for API-key JWTs issued before owner claims. */
export async function resolveApiKeyOwnerInternal(req, res, next) {
  try {
    const { apiKeyId, tenantId } = req.body ?? {};
    if (typeof apiKeyId !== 'string' || typeof tenantId !== 'string') {
      throw new ValidationError('API key and tenant identifiers are required');
    }
    const apiKey = await prisma.apiKey.findFirst({
      where: { id: apiKeyId, tenantId },
      select: { createdBy: true },
    });
    if (!apiKey) throw new NotFoundError('API key');
    res.json({ apiKeyContext: { createdBy: apiKey.createdBy } });
  } catch (err) {
    next(err);
  }
}

// ── POST /api-keys ────────────────────────────────────────────────────────────

export async function createApiKey(req, res, next) {
  try {
    const { tenantId, userId } = getCallerContext(req);
    const { name, scopes = [], expiresAt = null, metadata = null, oauthClientId = null } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name is required for the API key');
    }
    validateRequestedScopes(scopes);

    // Generate secure opaque API key with distinctive prefix
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const rawKey = `${API_KEY_PREFIX}${rawSecret}`;
    const keyPrefix = rawKey.substring(0, 20);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const expiresDate = expiresAt ? new Date(expiresAt) : null;
    if (expiresDate && isNaN(expiresDate.getTime())) {
      throw new ValidationError('Invalid expiresAt date format');
    }

    const created = await prisma.apiKey.create({
      data: {
        tenantId,
        name: name.trim(),
        keyPrefix,
        keyHash,
        scopes: Array.isArray(scopes) ? scopes : [],
        expiresAt: expiresDate,
        createdBy: userId,
        metadata: metadata || null,
        oauthClientId: oauthClientId || null,
        isActive: true,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        createdAt: true,
        metadata: true,
        oauthClientId: true,
      },
    });

    logger.info('API key created', {
      apiKeyId: created.id,
      tenantId,
      createdBy: userId,
      keyPrefix,
    });

    // Kafka audit log
    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'api_key',
        entityId: created.id,
        action: 'api_key.created',
        userId,
        metadata: {
          name: created.name,
          keyPrefix,
          scopes: created.scopes,
        },
      }).catch(() => {});
    }

    // Return plaintext raw key ONCE — it cannot be recovered after this
    res.status(201).json({
      apiKey: created,
      rawKey,
      warning: 'Store this raw API key securely. It cannot be displayed again.',
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api-keys ─────────────────────────────────────────────────────────────

export async function listApiKeys(req, res, next) {
  try {
    const { tenantId } = getCallerContext(req);

    const keys = await prisma.apiKey.findMany({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        lastUsedAt: true,
        lastUsedIp: true,
        revokedAt: true,
        createdAt: true,
        metadata: true,
        oauthClientId: true,
        // Never return keyHash
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ apiKeys: keys });
  } catch (err) {
    next(err);
  }
}

// ── GET /api-keys/:id ─────────────────────────────────────────────────────────

export async function getApiKey(req, res, next) {
  try {
    const { tenantId } = getCallerContext(req);

    const apiKey = await prisma.apiKey.findFirst({
      where: { id: req.params.id, tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        lastUsedAt: true,
        lastUsedIp: true,
        revokedAt: true,
        createdAt: true,
        metadata: true,
        oauthClientId: true,
      },
    });

    if (!apiKey) throw new NotFoundError('API key');
    res.json({ apiKey });
  } catch (err) {
    next(err);
  }
}

// ── POST /api-keys/:id/rotate ────────────────────────────────────────────────

export async function rotateApiKey(req, res, next) {
  try {
    const { tenantId, userId } = getCallerContext(req);
    const { scopes } = req.body ?? {};
    if (scopes !== undefined) validateRequestedScopes(scopes);

    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) throw new NotFoundError('API key');

    if (existing.revokedAt || !existing.isActive) {
      throw new ValidationError('Cannot rotate a revoked or inactive API key');
    }

    // Generate new secret
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const rawKey = `${API_KEY_PREFIX}${rawSecret}`;
    const keyPrefix = rawKey.substring(0, 20);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const created = await prisma.$transaction(async (tx) => {
      const revoked = await tx.apiKey.updateMany({
        where: { id: existing.id, tenantId, isActive: true, revokedAt: null },
        data: { isActive: false, revokedAt: new Date(), revokedBy: userId },
      });
      if (revoked.count !== 1) throw new ValidationError('API key changed while rotation was in progress');
      return tx.apiKey.create({
        data: {
          tenantId,
          name: existing.name,
          keyPrefix,
          keyHash,
          scopes: scopes ?? existing.scopes,
          expiresAt: existing.expiresAt,
          createdBy: userId,
          isActive: true,
        },
        select: {
          id: true,
          tenantId: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          isActive: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    });

    logger.info('API key rotated', {
      apiKeyId: created.id,
      rotatedFrom: existing.id,
      tenantId,
      rotatedBy: userId,
      keyPrefix,
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'api_key',
      entityId: created.id,
        action: 'api_key.rotated',
        userId,
        metadata: {
          keyPrefix,
        rotatedFrom: existing.id,
        },
      }).catch(() => {});
    }

    res.json({
      message: 'API key successfully rotated.',
      apiKey: created,
      rawKey,
      warning: 'Store this new raw API key securely. It cannot be displayed again.',
    });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api-keys/:id (or POST /api-keys/:id/revoke) ──────────────────────

export async function revokeApiKey(req, res, next) {
  try {
    const { tenantId, userId } = getCallerContext(req);

    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) throw new NotFoundError('API key');

    await prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedBy: userId,
      },
    });

    logger.info('API key revoked', {
      apiKeyId: existing.id,
      tenantId,
      revokedBy: userId,
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'api_key',
        entityId: existing.id,
        action: 'api_key.revoked',
        userId,
      }).catch(() => {});
    }

    res.json({ message: 'API key revoked successfully.' });
  } catch (err) {
    next(err);
  }
}
