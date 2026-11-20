/**
 * Headers injected by the API gateway on every proxied downstream request.
 */

/** Injects the shared gateway secret (required by downstream requireInternalRequest). */
export function attachInternalServiceToken(proxyReq, token = process.env.INTERNAL_SERVICE_TOKEN) {
  if (token) {
    proxyReq.setHeader('x-internal-service-token', token);
  }
}

/**
 * Forward authenticated user context + RBAC envelope to downstream microservices.
 * Always attaches the internal service token, even for unauthenticated public routes.
 */
export function attachDownstreamHeaders(proxyReq, req) {
  attachInternalServiceToken(proxyReq);
  if (!req?.user) return;

  proxyReq.setHeader('x-user-id', req.user.id);
  proxyReq.setHeader('x-tenant-id', req.user.tenantId);
  if (req.user.departmentId) proxyReq.setHeader('x-department-id', req.user.departmentId);
  if (req.user.email) proxyReq.setHeader('x-user-email', req.user.email);
  proxyReq.setHeader('x-must-change-password', req.user.mustChangePassword ? 'true' : 'false');

  const roleIds = req.rbacEnvelope?.roleIds;
  if (Array.isArray(roleIds) && roleIds.length) {
    proxyReq.setHeader('x-user-roles', roleIds.join(','));
  } else if (req.user.roles?.length) {
    proxyReq.setHeader('x-user-roles', req.user.roles.join(','));
  }

  const permissions = req.rbacEnvelope?.permissions;
  if (Array.isArray(permissions) && permissions.length) {
    proxyReq.setHeader('x-user-permissions', permissions.join(','));
  }
}

/** Alias used by proxy onProxyReq handlers. */
export function forwardProxyIdentity(proxyReq, req) {
  attachDownstreamHeaders(proxyReq, req);
}
