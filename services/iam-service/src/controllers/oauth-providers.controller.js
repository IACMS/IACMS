/**
 * oauth-providers.controller.js
 * Platform-admin CRUD for social and enterprise OAuthProvider configurations.
 * Routes: /oauth/providers
 */

import prisma from '../config/database.js';
import { encryptClientSecret } from '../oauth/client-secret.utils.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('iam-oauth-providers');

function assertPlatformAdmin(req) {
  const perms = req.headers['x-user-permissions'] || '';
  if (!perms.includes('platform:manage_tenants')) {
    throw new ForbiddenError('Only platform administrators may manage OAuth providers');
  }
}

// ── GET /oauth/providers ──────────────────────────────────────────────────────

export async function listProviders(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const providers = await prisma.oAuthProvider.findMany({
      select: {
        id: true,
        tenantId: true,
        provider: true,
        clientId: true,
        scopes: true,
        isActive: true,
        config: true,
        createdAt: true,
        updatedAt: true,
        // Never return clientSecretEnc
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ providers });
  } catch (err) {
    next(err);
  }
}

// ── POST /oauth/providers ─────────────────────────────────────────────────────

export async function createProvider(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const {
      tenantId,
      provider,
      clientId,
      clientSecret,
      scopes = [],
      isActive = true,
      config = null,
    } = req.body ?? {};

    if (!provider) throw new ValidationError('provider is required');
    if (!clientId) throw new ValidationError('clientId is required');
    if (!clientSecret) throw new ValidationError('clientSecret is required');

    const normalizedProvider = provider.toLowerCase();
    const clientSecretEnc = encryptClientSecret(clientSecret);

    const created = await prisma.oAuthProvider.create({
      data: {
        tenantId: tenantId ?? null,
        provider: normalizedProvider,
        clientId,
        clientSecretEnc,
        scopes,
        isActive,
        config,
      },
      select: {
        id: true,
        tenantId: true,
        provider: true,
        clientId: true,
        scopes: true,
        isActive: true,
        config: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logger.info('OAuth provider configured', {
      providerId: created.id,
      provider: created.provider,
      tenantId: created.tenantId,
      createdBy: req.headers['x-user-id'],
    });

    res.status(201).json({ provider: created });
  } catch (err) {
    next(err);
  }
}

// ── GET /oauth/providers/:id ──────────────────────────────────────────────────

export async function getProvider(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const provider = await prisma.oAuthProvider.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        tenantId: true,
        provider: true,
        clientId: true,
        scopes: true,
        isActive: true,
        config: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!provider) throw new NotFoundError('OAuth provider');
    res.json({ provider });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /oauth/providers/:id ────────────────────────────────────────────────

export async function updateProvider(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const { clientId, clientSecret, scopes, isActive, config } = req.body ?? {};

    const existing = await prisma.oAuthProvider.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw new NotFoundError('OAuth provider');

    const updateData = {
      ...(clientId !== undefined ? { clientId } : {}),
      ...(scopes !== undefined ? { scopes } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(config !== undefined ? { config } : {}),
    };

    if (clientSecret) {
      updateData.clientSecretEnc = encryptClientSecret(clientSecret);
    }

    const updated = await prisma.oAuthProvider.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true,
        tenantId: true,
        provider: true,
        clientId: true,
        scopes: true,
        isActive: true,
        config: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logger.info('OAuth provider updated', {
      providerId: updated.id,
      provider: updated.provider,
      updatedBy: req.headers['x-user-id'],
    });

    res.json({ provider: updated });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /oauth/providers/:id ───────────────────────────────────────────────

export async function deleteProvider(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const existing = await prisma.oAuthProvider.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw new NotFoundError('OAuth provider');

    await prisma.oAuthProvider.delete({ where: { id: req.params.id } });

    logger.info('OAuth provider deleted', {
      providerId: req.params.id,
      provider: existing.provider,
      deletedBy: req.headers['x-user-id'],
    });

    res.json({ message: 'OAuth provider deleted.' });
  } catch (err) {
    next(err);
  }
}

