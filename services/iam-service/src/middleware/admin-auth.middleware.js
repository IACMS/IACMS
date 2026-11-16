import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { UnauthorizedError, ForbiddenError } from '#iam/iamErrors.js';
import prisma from '../config/database.js';
import { getRedisClient } from '../config/redis.config.js';
import { resolveGatewayIdentity } from '#iam/iamGatewayIdentity.js';
import { loadJwks } from '../oauth/jwks.js';

let localJwks;
function getLocalJwks() {
  if (!localJwks) localJwks = createLocalJWKSet(loadJwks());
  return localJwks;
}

function timingSafeSecretMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

async function authorizeGatewayAdmin(req) {
  const identity = await resolveGatewayIdentity(prisma, req);
  if (!identity) throw new UnauthorizedError('A valid gateway identity is required');

  const permissions = identity.permissions || [];
  const directAdminPermission = permissions.some((permission) =>
    ['platform:manage_tenants', 'iam:admin', '*', 'admin:*'].includes(permission),
  );
  const roleValues = identity.roles || [];
  let hasAdminRole = roleValues.some((role) => ['system_admin', 'system-admin', 'iam-admin'].includes(role));
  const roleIds = roleValues.filter((role) => /^[0-9a-f-]{36}$/i.test(role));
  if (!hasAdminRole && roleIds.length) {
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds }, isActive: true },
      select: { name: true, slug: true },
    });
    hasAdminRole = roles.some((role) =>
      ['system_admin', 'system-admin', 'iam-admin'].includes(role.slug) || role.name === 'system_admin',
    );
  }
  if (!directAdminPermission && !hasAdminRole) throw new ForbiddenError('IAM administrator access is required');
  req.user = identity;
  req.iamAdminAuthorized = true;
  req.iamAdminAuthType = 'gateway';
}

async function authorizeOidcAdmin(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new UnauthorizedError('An IAM administrator access token is required');

  const issuer = process.env.OIDC_ISSUER || 'http://localhost:3001';
  const audience = process.env.IAM_ADMIN_AUDIENCE || `${issuer.replace(/\/$/, '')}/admin-api`;
  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], getLocalJwks(), {
      issuer,
      audience,
      algorithms: ['RS256'],
    }));
  } catch {
    throw new UnauthorizedError('Invalid IAM administrator access token');
  }

  const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
  if (!payload.sub || !scopes.includes('iam:admin') || payload.iam_admin !== true) {
    throw new ForbiddenError('The access token is not authorized for IAM administration');
  }

  const clientId = payload.client_id || payload.azp;
  if (!clientId) throw new UnauthorizedError('The access token is missing its OAuth client identity');
  const client = await prisma.oAuthClient.findFirst({
    where: { clientId, isActive: true, targetAudience: audience },
    select: { id: true, iamOrganizationId: true },
  });
  if (!client) throw new ForbiddenError('The OAuth client is not registered for IAM administration');

  const [user, assignment] = await Promise.all([
    prisma.user.findFirst({ where: { id: payload.sub, isActive: true }, select: { id: true } }),
    prisma.userApplicationRole.findFirst({
      where: {
        userId: payload.sub,
        oauthClientId: client.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        role: { isActive: true, slug: { in: ['system-admin', 'iam-admin'] } },
      },
      select: { id: true },
    }),
  ]);
  if (!user || !assignment) throw new ForbiddenError('An active IAM administrator role assignment is required');

  if (client.iamOrganizationId) {
    const membership = await prisma.iamMembership.findFirst({
      where: {
        subjectId: payload.sub,
        organizationId: client.iamOrganizationId,
        status: 'active',
        organization: { is: { isActive: true } },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenError('An active IAM administrator organization membership is required');
  }

  req.user = {
    id: user.id,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    permissions: ['iam:admin'],
  };
  req.iamAdminAuthorized = true;
  req.iamAdminAuthType = 'oidc';
}

async function authorizeBearerAdmin(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new UnauthorizedError('An IAM administrator access token is required');

  const token = match[1];

  // 1. Try RS256 OIDC Token
  let oidcFailed = false;
  try {
    await authorizeOidcAdmin(req);
    return;
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    oidcFailed = true;
  }

  // 2. Try direct HMAC JWT_SECRET session token (platform administrator)
  if (oidcFailed && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.id) {
        if (decoded.type === 'refresh' || (!decoded.roles && !decoded.tenantId)) {
          throw new UnauthorizedError('Invalid IAM administrator access token');
        }

        if (decoded.jti) {
          try {
            const redis = getRedisClient();
            if (redis) {
              const isBlacklisted = await redis.get(`auth:blacklist:${decoded.jti}`);
              if (isBlacklisted) {
                throw new UnauthorizedError('Token has been revoked');
              }
            }
          } catch (err) {
            if (err instanceof UnauthorizedError) throw err;
          }
        }

        const user = await prisma.user.findFirst({
          where: { id: decoded.id, isActive: true },
          include: {
            tenant: { select: { id: true, code: true, isActive: true } },
            userRoles: {
              where: {
                role: { isActive: true },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
              include: { role: { select: { id: true, name: true, slug: true, isActive: true } } },
            },
          },
        });

        if (!user || !user.tenant?.isActive) {
          throw new UnauthorizedError('Inactive user or organization');
        }

        if (decoded.mustChangePassword || user.mustChangePassword) {
          throw new ForbiddenError('Password change required');
        }

        const now = new Date();
        const activeAdminRoles = (user.userRoles || []).filter((ur) => {
          const role = ur.role;
          if (!role || role.isActive === false) return false;
          if (ur.expiresAt && new Date(ur.expiresAt) <= now) return false;
          const slug = role.slug || role.name;
          return ['system_admin', 'system-admin', 'iam-admin'].includes(slug);
        });

        if (activeAdminRoles.length === 0) {
          throw new ForbiddenError('IAM administrator access is required');
        }

        const roleSlugs = activeAdminRoles.map((ur) => ur.role?.slug || ur.role?.name);
        req.user = {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          roles: roleSlugs,
          permissions: ['iam:admin'],
        };
        req.iamAdminAuthorized = true;
        req.iamAdminAuthType = 'session';
        return;
      }
    } catch (jwtErr) {
      if (jwtErr instanceof ForbiddenError || jwtErr instanceof UnauthorizedError) throw jwtErr;
    }
  }

  throw new UnauthorizedError('Invalid IAM administrator access token');
}

/**
 * Admin APIs accept either the existing trusted IACMS gateway call, a
 * direct platform admin session JWT, or an OIDC access token.
 */
export async function authenticateAdminRequest(req, res, next) {
  try {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    const hasGatewayToken = timingSafeSecretMatch(req.headers['x-internal-service-token'], expected);
    const hasGatewayHeaders = Boolean(req.headers['x-user-id'] && req.headers['x-tenant-id']);

    if (hasGatewayToken && hasGatewayHeaders) {
      await authorizeGatewayAdmin(req);
    } else {
      await authorizeBearerAdmin(req);
    }
    return next();
  } catch (error) {
    return next(error);
  }
}
