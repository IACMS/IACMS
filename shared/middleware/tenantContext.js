/**
 * Parses gateway-injected tenant id onto the request object.
 *
 * Database RLS remains **off**; isolation is enforced in Prisma predicates per
 * docs/TENANT_ISOLATION.md. This middleware is optional and safe to enable on services.
 */

export function tenantContextMiddleware(req, _res, next) {
  const raw = req.headers['x-tenant-id'];
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    req.iacmsTenantId = String(raw).trim();
  } else {
    req.iacmsTenantId = undefined;
  }
  next();
}
