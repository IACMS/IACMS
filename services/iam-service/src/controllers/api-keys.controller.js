/**
 * api-keys.controller.js
 * Tenant-scoped CRUD and rotation for M2M partner API keys.
 * Routes: /api-keys
 */

import crypto from 'crypto';
import prisma from '../config/database.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';
import { getEventBus } from '../utils/auth.helpers.js';
import { TOPICS } from '../../../../shared/utils/eventBus.js';

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

export const AVAILABLE_SCOPES = [
  '*',
  'cases:read',
  'cases:create',
  'cases:update',
  'referrals:read',
  'referrals:create',
  'workflows:read',
  'workflows:update',
  'assignments:read',
  'auditLogs:read',
  'departments:read',
  'metrics:read',
];

export async function getScopes(req, res, next) {
  try {
    res.json({ scopes: AVAILABLE_SCOPES });
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

    // Generate secure opaque API key with distinctive prefix
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const rawKey = `iacms_live_${rawSecret}`;
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

    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) throw new NotFoundError('API key');

    if (existing.revokedAt || !existing.isActive) {
      throw new ValidationError('Cannot rotate a revoked or inactive API key');
    }

    // Generate new secret
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const rawKey = `iacms_live_${rawSecret}`;
    const keyPrefix = rawKey.substring(0, 20);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const updated = await prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        keyPrefix,
        keyHash,
        lastUsedAt: null,
        lastUsedIp: null,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        updatedAt: true,
      },
    });

    logger.info('API key rotated', {
      apiKeyId: updated.id,
      tenantId,
      rotatedBy: userId,
      keyPrefix,
    });

    const bus = getEventBus();
    if (bus) {
      bus.publish(TOPICS.AUDIT_LOG, {
        tenantId,
        entityType: 'api_key',
        entityId: updated.id,
        action: 'api_key.rotated',
        userId,
        metadata: {
          keyPrefix,
        },
      }).catch(() => {});
    }

    res.json({
      message: 'API key successfully rotated.',
      apiKey: updated,
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
