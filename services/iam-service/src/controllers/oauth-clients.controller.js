/**
 * oauth-clients.controller.js
 * Platform-admin CRUD for OAuthClient records.
 * Routes: /oauth/clients
 *
 * Only platform admins (x-user-permissions includes 'platform:manage_tenants')
 * may create/update/delete clients. Reading is restricted to platform admins too;
 * client secrets are NEVER returned in responses.
 */

import crypto from 'crypto';
import prisma from '../config/database.js';
import { encryptClientSecret } from '../oauth/client-secret.utils.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('iam-oauth-clients');

function assertPlatformAdmin(req) {
  const perms = req.headers['x-user-permissions'] || '';
  if (!perms.includes('platform:manage_tenants')) {
    throw new ForbiddenError('Only platform administrators may manage OAuth clients');
  }
}

// ── GET /oauth/clients ────────────────────────────────────────────────────────

export async function listClients(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const clients = await prisma.oAuthClient.findMany({
      select: {
        id: true,
        clientId: true,
        name: true,
        tenantId: true,
        redirectUris: true,
        grantTypes: true,
        responseTypes: true,
        scope: true,
        tokenEndpointAuthMethod: true,
        isActive: true,
        createdAt: true,
        // Never return clientSecretCiphertext
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ clients });
  } catch (err) {
    next(err);
  }
}

// ── POST /oauth/clients ───────────────────────────────────────────────────────

export async function createClient(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const {
      name,
      tenantId,
      redirectUris = [],
      grantTypes = ['authorization_code'],
      responseTypes = ['code'],
      scope = 'openid profile email',
      tokenEndpointAuthMethod = 'client_secret_basic',
    } = req.body ?? {};

    if (!name) throw new ValidationError('name is required');

    // Generate a random client_id and secret
    const clientId = `iacms_${crypto.randomBytes(16).toString('hex')}`;
    const plainSecret = crypto.randomBytes(32).toString('hex');
    const clientSecretCiphertext = encryptClientSecret(plainSecret);

    const client = await prisma.oAuthClient.create({
      data: {
        clientId,
        clientSecretCiphertext,
        name,
        tenantId: tenantId ?? null,
        redirectUris,
        grantTypes,
        responseTypes,
        scope,
        tokenEndpointAuthMethod,
      },
      select: {
        id: true,
        clientId: true,
        name: true,
        tenantId: true,
        redirectUris: true,
        grantTypes: true,
        responseTypes: true,
        scope: true,
        tokenEndpointAuthMethod: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info('OAuth client created', { clientId, name, createdBy: req.headers['x-user-id'] });

    // Return the plaintext secret ONCE — it cannot be recovered after this
    res.status(201).json({ client, clientSecret: plainSecret });
  } catch (err) {
    next(err);
  }
}

// ── GET /oauth/clients/:id ────────────────────────────────────────────────────

export async function getClient(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const client = await prisma.oAuthClient.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        clientId: true,
        name: true,
        tenantId: true,
        redirectUris: true,
        grantTypes: true,
        responseTypes: true,
        scope: true,
        tokenEndpointAuthMethod: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!client) throw new NotFoundError('OAuth client');
    res.json({ client });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /oauth/clients/:id ──────────────────────────────────────────────────

export async function updateClient(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const { name, redirectUris, grantTypes, responseTypes, scope, tokenEndpointAuthMethod, isActive } = req.body ?? {};

    const existing = await prisma.oAuthClient.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('OAuth client');

    const client = await prisma.oAuthClient.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(redirectUris !== undefined ? { redirectUris } : {}),
        ...(grantTypes !== undefined ? { grantTypes } : {}),
        ...(responseTypes !== undefined ? { responseTypes } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(tokenEndpointAuthMethod !== undefined ? { tokenEndpointAuthMethod } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      select: {
        id: true, clientId: true, name: true, tenantId: true,
        redirectUris: true, grantTypes: true, responseTypes: true,
        scope: true, tokenEndpointAuthMethod: true, isActive: true, updatedAt: true,
      },
    });

    logger.info('OAuth client updated', { clientId: existing.clientId, updatedBy: req.headers['x-user-id'] });
    res.json({ client });
  } catch (err) {
    next(err);
  }
}

// ── POST /oauth/clients/:id/rotate-secret ────────────────────────────────────

export async function rotateClientSecret(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const existing = await prisma.oAuthClient.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('OAuth client');

    const plainSecret = crypto.randomBytes(32).toString('hex');
    const clientSecretCiphertext = encryptClientSecret(plainSecret);

    await prisma.oAuthClient.update({
      where: { id: req.params.id },
      data: { clientSecretCiphertext },
    });

    logger.info('OAuth client secret rotated', { clientId: existing.clientId, rotatedBy: req.headers['x-user-id'] });
    res.json({ message: 'Client secret rotated.', clientSecret: plainSecret });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /oauth/clients/:id ─────────────────────────────────────────────────

export async function deleteClient(req, res, next) {
  try {
    assertPlatformAdmin(req);

    const existing = await prisma.oAuthClient.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('OAuth client');

    await prisma.oAuthClient.delete({ where: { id: req.params.id } });
    logger.info('OAuth client deleted', { clientId: existing.clientId, deletedBy: req.headers['x-user-id'] });
    res.json({ message: 'OAuth client deleted.' });
  } catch (err) {
    next(err);
  }
}
