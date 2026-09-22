/**
 * Gateway identity resolution for downstream microservices.
 *
 * Performance model:
 * - Production: `requireInternalRequest` proves the caller is the API gateway.
 *   When `x-internal-service-token` matches, identity headers are trusted with
 *   **zero Postgres queries** (the gateway already authenticated the user).
 * - Development: If `INTERNAL_SERVICE_TOKEN` is unset, services may be hit
 *   directly; headers are verified once against Postgres to prevent spoofing.
 */

function splitHeaderList(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

/** True when the request carries the shared gateway → service secret. */
export function hasValidInternalServiceToken(req) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!expected) return false;
  return req.headers['x-internal-service-token'] === expected;
}

/**
 * Build `req.user` from gateway-injected headers (no I/O).
 * @param {import('express').Request} req
 */
export function buildUserFromGatewayHeaders(req) {
  const headerUserId = req.headers['x-user-id'];
  const headerTenantId = req.headers['x-tenant-id'];
  if (!headerUserId || !headerTenantId) return null;

  const mcp = req.headers['x-must-change-password'];
  const mustChangePassword = mcp === '1' || mcp === 'true';

  return {
    id: String(headerUserId),
    tenantId: String(headerTenantId),
    departmentId: req.headers['x-department-id'] ? String(req.headers['x-department-id']) : null,
    email: req.headers['x-user-email'] ? String(req.headers['x-user-email']) : null,
    roles: splitHeaderList(req.headers['x-user-roles']),
    permissions: splitHeaderList(req.headers['x-user-permissions']),
    mustChangePassword,
  };
}

/**
 * Dev-only fallback: verify forwarded headers against Postgres (single query).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {import('express').Request} req
 */
export async function verifyGatewayHeadersInDatabase(prisma, req) {
  const headerUserId = req.headers['x-user-id'];
  const headerTenantId = req.headers['x-tenant-id'];
  if (!headerUserId || !headerTenantId) return null;

  const u = await prisma.user.findFirst({
    where: { id: String(headerUserId), isActive: true },
    select: {
      id: true,
      tenantId: true,
      departmentId: true,
      email: true,
      mustChangePassword: true,
      userRoles: { select: { roleId: true } },
    },
  });

  if (!u || u.tenantId !== String(headerTenantId)) return null;

  return {
    id: u.id,
    tenantId: u.tenantId,
    departmentId: u.departmentId ?? null,
    email: u.email,
    roles: u.userRoles.map((r) => r.roleId),
    permissions: splitHeaderList(req.headers['x-user-permissions']),
    mustChangePassword: u.mustChangePassword ?? false,
  };
}

/**
 * Resolve identity from gateway headers — fast path when internal token is valid,
 * otherwise a single DB lookup (local dev direct access).
 *
 * @param {import('@prisma/client').PrismaClient | null | undefined} prisma
 * @param {import('express').Request} req
 */
export async function resolveGatewayIdentity(prisma, req) {
  if (!req.headers['x-user-id'] || !req.headers['x-tenant-id']) return null;

  if (hasValidInternalServiceToken(req)) {
    return buildUserFromGatewayHeaders(req);
  }

  if (!prisma) return null;
  return verifyGatewayHeadersInDatabase(prisma, req);
}

/** @deprecated Use resolveGatewayIdentity — kept for any external imports */
export async function loadUserFromGatewayHeaders(prisma, req) {
  return resolveGatewayIdentity(prisma, req);
}
