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
import { ValidationError, NotFoundError, ForbiddenError } from '#iam/iamErrors.js';
import Logger from '#iam/iamLogger.js';
import { legacyOrganizationSystem } from '../legacyOrganizationSystem.js';
import { isPlatformAdminRequest } from '../utils/internalToken.js';

const logger = new Logger('iam-oauth-clients');

export async function assertAdminScope(req) {
  if (req.iamAdminScope) return req.iamAdminScope;
  if (isPlatformAdminRequest(req)) return { type: 'platform' };

  const roleIds = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : [];
  if (roleIds.length) {
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds }, isActive: true },
      select: { name: true, slug: true },
    });
    if (roles.some((r) => r.name === 'system_admin' || r.slug === 'system-admin' || r.slug === 'iam-admin')) {
      return { type: 'platform' };
    }
    if (roles.some((r) => r.name === 'tenant_admin' || r.slug === 'tenant-admin')) {
      return {
        type: 'organization',
        organizationId: req.user?.organizationId || null,
        tenantId: req.user?.tenantId || null,
      };
    }
  }
  throw new ForbiddenError('Only administrators may manage OAuth clients');
}

export function assertClientInScope(client, adminScope) {
  if (!client) throw new NotFoundError('OAuth client');
  if (adminScope.type === 'platform') return;
  const matchesOrg = adminScope.organizationId && client.iamOrganizationId === adminScope.organizationId;
  const matchesTenant = adminScope.tenantId && client.tenantId === adminScope.tenantId;
  if (!matchesOrg && !matchesTenant) {
    throw new NotFoundError('OAuth client');
  }
}

export async function assertPlatformAdmin(req) {
  const scope = await assertAdminScope(req);
  if (scope.type !== 'platform') {
    throw new ForbiddenError('Only platform administrators may manage OAuth clients');
  }
}

// ── GET /oauth/clients ────────────────────────────────────────────────────────

export async function listClients(req, res, next) {
  try {
    const adminScope = await assertAdminScope(req);
    let where = {};
    if (adminScope.type === 'organization') {
      const orClauses = [];
      if (adminScope.organizationId) orClauses.push({ iamOrganizationId: adminScope.organizationId });
      if (adminScope.tenantId) orClauses.push({ tenantId: adminScope.tenantId });
      where = { OR: orClauses.length ? orClauses : [{ id: '00000000-0000-0000-0000-000000000000' }] };
    }

    const clients = await prisma.oAuthClient.findMany({
      where,
      select: {
        id: true,
        clientId: true,
        name: true,
        tenantId: true,
        iamOrganizationId: true,
        redirectUris: true,
        grantTypes: true,
        responseTypes: true,
        scope: true,
        tokenEndpointAuthMethod: true,
        targetAudience: true,
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
    const adminScope = await assertAdminScope(req);

    const {
      name,
      tenantId,
      iamOrganizationId,
      redirectUris = [],
      grantTypes = ['authorization_code'],
      responseTypes = ['code'],
      scope = 'openid profile email',
      tokenEndpointAuthMethod = 'client_secret_basic',
      targetAudience = null,
    } = req.body ?? {};

    if (!name) throw new ValidationError('name is required');

    for (const uri of redirectUris) {
      try {
        const parsed = new URL(uri);
        const isLocalhost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
        if (parsed.protocol !== 'https:' && !(isLocalhost && process.env.NODE_ENV !== 'production')) {
          throw new ValidationError('Redirect URIs must use HTTPS (localhost is permitted in development only)');
        }
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError('Invalid redirect URI');
      }
    }

    let effectiveTenantId = tenantId;
    let effectiveOrgId = iamOrganizationId;

    if (adminScope.type === 'organization') {
      if (grantTypes.includes('client_credentials')) {
        throw new ForbiddenError('Client admins cannot create client_credentials clients');
      }
      const requestedScopes = (scope || '').split(/\s+/).filter(Boolean);
      if (requestedScopes.includes('iam:admin') || requestedScopes.includes('api_key')) {
        throw new ForbiddenError('Client admins cannot request iam:admin or api_key scopes');
      }
      effectiveOrgId = adminScope.organizationId;
      effectiveTenantId = adminScope.tenantId;

      const existingOrgClients = await prisma.oAuthClient.findMany({
        where: {
          OR: [
            ...(adminScope.organizationId ? [{ iamOrganizationId: adminScope.organizationId }] : []),
            ...(adminScope.tenantId ? [{ tenantId: adminScope.tenantId }] : []),
          ],
        },
        select: { targetAudience: true },
      });
      const grantedAudiences = new Set(
        existingOrgClients.map((c) => c.targetAudience).filter(Boolean)
      );
      if (process.env.ALLOWED_CLIENT_AUDIENCES) {
        process.env.ALLOWED_CLIENT_AUDIENCES.split(',').map((s) => s.trim()).forEach((a) => grantedAudiences.add(a));
      }
      if (targetAudience && grantedAudiences.size > 0 && !grantedAudiences.has(targetAudience)) {
        throw new ForbiddenError('targetAudience has not been granted by a platform administrator');
      }
    }

    if (effectiveOrgId !== undefined && effectiveOrgId !== null) {
      if (typeof effectiveOrgId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(effectiveOrgId)) {
        throw new ValidationError('iamOrganizationId must be a UUID');
      }
      const organization = await prisma.iamOrganization.findUnique({
        where: { id: effectiveOrgId },
        select: { id: true, isActive: true, externalSystem: true, externalId: true },
      });
      if (!organization) throw new NotFoundError('IAM organization');
      if (!organization.isActive) throw new ValidationError('Cannot bind an OAuth client to an inactive IAM organization');
      if (effectiveTenantId && (organization.externalSystem !== legacyOrganizationSystem() || organization.externalId !== effectiveTenantId)) {
        throw new ValidationError('tenantId and iamOrganizationId must refer to the same mapped organization');
      }
    }
    if (typeof targetAudience !== 'string' || !targetAudience.trim()) {
      throw new ValidationError('targetAudience is required for new OAuth clients');
    }
    try {
      const parsedAudience = new URL(targetAudience.trim());
      if (!['https:', 'http:'].includes(parsedAudience.protocol)) throw new Error('unsupported protocol');
      if (process.env.NODE_ENV === 'production' && parsedAudience.protocol !== 'https:') {
        throw new Error('HTTPS is required in production');
      }
    } catch {
      throw new ValidationError('targetAudience must be an absolute HTTP(S) URI; use HTTPS in production');
    }
    if (tokenEndpointAuthMethod === 'none' && grantTypes.includes('client_credentials')) {
      throw new ValidationError('Public clients cannot use the client_credentials grant');
    }

    for (const uri of redirectUris) {
      try {
        const parsed = new URL(uri);
        const isLocalhost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
        if (parsed.protocol !== 'https:' && !(isLocalhost && process.env.NODE_ENV !== 'production')) {
          throw new ValidationError('Redirect URIs must use HTTPS (localhost is permitted in development only)');
        }
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError('Invalid redirect URI');
      }
    }

    // Public clients (SPA/native) do not have secrets. Confidential clients receive
    // a secret once at registration; only its encrypted form is persisted.
    const clientId = `iam_${crypto.randomBytes(16).toString('hex')}`;
    const plainSecret = tokenEndpointAuthMethod === 'none' ? null : crypto.randomBytes(32).toString('hex');
    const clientSecretCiphertext = plainSecret ? encryptClientSecret(plainSecret) : null;

    const client = await prisma.oAuthClient.create({
      data: {
        clientId,
        clientSecretCiphertext,
        name,
        tenantId: effectiveTenantId ?? null,
        iamOrganizationId: effectiveOrgId ?? null,
        redirectUris,
        grantTypes,
        responseTypes,
        scope,
        tokenEndpointAuthMethod,
        targetAudience: targetAudience || null,
      },
      select: {
        id: true,
        clientId: true,
        name: true,
        tenantId: true,
        iamOrganizationId: true,
        redirectUris: true,
        grantTypes: true,
        responseTypes: true,
        scope: true,
        tokenEndpointAuthMethod: true,
        targetAudience: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info('OAuth client created', { clientId, name, createdBy: req.headers['x-user-id'] });

    // Return the plaintext secret ONCE — it cannot be recovered after this
    res.status(201).json({ client, ...(plainSecret ? { clientSecret: plainSecret } : {}) });
  } catch (err) {
    next(err);
  }
}

// ── GET /oauth/clients/:id ────────────────────────────────────────────────────

export async function getClient(req, res, next) {
  try {
    const adminScope = await assertAdminScope(req);

    const client = await prisma.oAuthClient.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        clientId: true,
        name: true,
        tenantId: true,
        iamOrganizationId: true,
        redirectUris: true,
        grantTypes: true,
        responseTypes: true,
        scope: true,
        tokenEndpointAuthMethod: true,
        targetAudience: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    assertClientInScope(client, adminScope);
    res.json({ client });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /oauth/clients/:id ──────────────────────────────────────────────────

export async function updateClient(req, res, next) {
  try {
    const adminScope = await assertAdminScope(req);

    const {
      name,
      redirectUris,
      grantTypes,
      responseTypes,
      scope,
      tokenEndpointAuthMethod,
      targetAudience,
      iamOrganizationId,
      isActive,
    } = req.body ?? {};

    const existing = await prisma.oAuthClient.findUnique({
      where: { id: req.params.id },
      select: { id: true, clientId: true, tenantId: true, iamOrganizationId: true },
    });
    assertClientInScope(existing, adminScope);

    if (adminScope.type === 'organization') {
      if (grantTypes && grantTypes.includes('client_credentials')) {
        throw new ForbiddenError('Client admins cannot use client_credentials');
      }
      if (scope) {
        const scopes = scope.split(/\s+/).filter(Boolean);
        if (scopes.includes('iam:admin') || scopes.includes('api_key')) {
          throw new ForbiddenError('Client admins cannot request iam:admin or api_key scopes');
        }
      }
      if (iamOrganizationId && iamOrganizationId !== adminScope.organizationId) {
        throw new ForbiddenError('Cannot change client organization');
      }
    }

    if (redirectUris) {
      for (const uri of redirectUris) {
        try {
          const parsed = new URL(uri);
          const isLocalhost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
          if (parsed.protocol !== 'https:' && !(isLocalhost && process.env.NODE_ENV !== 'production')) {
            throw new ValidationError('Redirect URIs must use HTTPS (localhost is permitted in development only)');
          }
        } catch (e) {
          if (e instanceof ValidationError) throw e;
          throw new ValidationError('Invalid redirect URI');
        }
      }
    }

    if (targetAudience !== undefined) {
      if (typeof targetAudience !== 'string' || !targetAudience.trim()) {
        throw new ValidationError('targetAudience cannot be empty');
      }
      try {
        const parsedAudience = new URL(targetAudience.trim());
        if (!['https:', 'http:'].includes(parsedAudience.protocol)) throw new Error('unsupported protocol');
        if (process.env.NODE_ENV === 'production' && parsedAudience.protocol !== 'https:') {
          throw new Error('HTTPS is required in production');
        }
      } catch {
        throw new ValidationError('targetAudience must be an absolute HTTP(S) URI; use HTTPS in production');
      }
    }

    if (iamOrganizationId !== undefined && iamOrganizationId !== null) {
      if (typeof iamOrganizationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(iamOrganizationId)) {
        throw new ValidationError('iamOrganizationId must be a UUID');
      }
      const organization = await prisma.iamOrganization.findUnique({
        where: { id: iamOrganizationId },
        select: { id: true, isActive: true, externalSystem: true, externalId: true },
      });
      if (!organization) throw new NotFoundError('IAM organization');
      if (!organization.isActive) throw new ValidationError('Cannot bind an OAuth client to an inactive IAM organization');
      if (existing.tenantId && (
        organization.externalSystem !== legacyOrganizationSystem() ||
        organization.externalId !== existing.tenantId
      )) {
        throw new ValidationError('tenantId and iamOrganizationId must refer to the same mapped organization');
      }
    }

    const client = await prisma.oAuthClient.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(redirectUris !== undefined ? { redirectUris } : {}),
        ...(grantTypes !== undefined ? { grantTypes } : {}),
        ...(responseTypes !== undefined ? { responseTypes } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(tokenEndpointAuthMethod !== undefined ? { tokenEndpointAuthMethod } : {}),
        ...(targetAudience !== undefined ? { targetAudience: targetAudience || null } : {}),
        ...(iamOrganizationId !== undefined ? { iamOrganizationId } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      select: {
        id: true,
        clientId: true,
        name: true,
        tenantId: true,
        iamOrganizationId: true,
        redirectUris: true,
        grantTypes: true,
        responseTypes: true,
        scope: true,
        tokenEndpointAuthMethod: true,
        targetAudience: true,
        isActive: true,
        updatedAt: true,
      },
    });

    logger.info('OAuth client updated', { clientId: existing.clientId, updatedBy: req.headers['x-user-id'] });
    res.json({ client });
  } catch (err) {
    next(err);
  }
}

// ── GET /oauth/clients/:id/users ──────────────────────────────────────────────

export async function listClientUsers(req, res, next) {
  try {
    const adminScope = await assertAdminScope(req);

    const client = await prisma.oAuthClient.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, clientId: true, iamOrganizationId: true, tenantId: true },
    });
    assertClientInScope(client, adminScope);

    const appRoles = await prisma.userApplicationRole.findMany({
      where: { oauthClientId: client.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isActive: true,
            tenant: { select: { id: true, name: true, code: true } },
          },
        },
        role: {
          select: { id: true, name: true, description: true },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    // Group assigned roles by user
    const usersMap = new Map();
    for (const ar of appRoles) {
      if (!usersMap.has(ar.user.id)) {
        usersMap.set(ar.user.id, {
          user: ar.user,
          roles: [],
        });
      }
      usersMap.get(ar.user.id).roles.push({
        id: ar.role.id,
        name: ar.role.name,
        assignedAt: ar.assignedAt,
        expiresAt: ar.expiresAt,
      });
    }

    res.json({
      client: { id: client.id, name: client.name, clientId: client.clientId },
      users: Array.from(usersMap.values()),
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /oauth/clients/:id/users ─────────────────────────────────────────────

export async function assignClientUserRole(req, res, next) {
  try {
    const adminScope = await assertAdminScope(req);

    const { userId, roleId, expiresAt } = req.body ?? {};
    if (!userId) throw new ValidationError('userId is required');
    if (!roleId) throw new ValidationError('roleId is required');

    const client = await prisma.oAuthClient.findUnique({ where: { id: req.params.id } });
    assertClientInScope(client, adminScope);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundError('Role');

    const callerId = req.user?.id || req.headers['x-user-id'] || null;

    const assignment = await prisma.userApplicationRole.upsert({
      where: {
        userId_oauthClientId_roleId: {
          userId,
          oauthClientId: client.id,
          roleId,
        },
      },
      update: {
        assignedBy: callerId,
        assignedAt: new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      create: {
        userId,
        oauthClientId: client.id,
        roleId,
        assignedBy: callerId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      include: {
        role: { select: { id: true, name: true } },
      },
    });

    logger.info('User application role assigned', {
      clientId: client.clientId,
      userId,
      role: role.name,
      assignedBy: callerId,
    });

    res.status(201).json({ assignment });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /oauth/clients/:id/users/:userId/roles/:roleId ─────────────────────

export async function unassignClientUserRole(req, res, next) {
  try {
    const adminScope = await assertAdminScope(req);

    const { id: oauthClientId, userId, roleId } = req.params;
    const client = await prisma.oAuthClient.findUnique({ where: { id: oauthClientId } });
    assertClientInScope(client, adminScope);

    await prisma.userApplicationRole.deleteMany({
      where: {
        oauthClientId,
        userId,
        roleId,
      },
    });

    logger.info('User application role unassigned', { oauthClientId, userId, roleId });
    res.json({ message: 'User role removed from application successfully.' });
  } catch (err) {
    next(err);
  }
}

// ── POST /oauth/clients/:id/rotate-secret ────────────────────────────────────

export async function rotateClientSecret(req, res, next) {
  try {
    const adminScope = await assertAdminScope(req);

    const existing = await prisma.oAuthClient.findUnique({ where: { id: req.params.id } });
    assertClientInScope(existing, adminScope);

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
    const adminScope = await assertAdminScope(req);

    const existing = await prisma.oAuthClient.findUnique({ where: { id: req.params.id } });
    assertClientInScope(existing, adminScope);

    await prisma.oAuthClient.delete({ where: { id: req.params.id } });
    logger.info('OAuth client deleted', { clientId: existing.clientId, deletedBy: req.headers['x-user-id'] });
    res.json({ message: 'OAuth client deleted.' });
  } catch (err) {
    next(err);
  }
}
