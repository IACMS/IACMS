/**
 * Headers injected by the API gateway on every proxied downstream request.
 */

const STRIP_HEADER_NAMES = [
  'x-tenant-id',
  'x-department-id',
  'x-must-change-password',
  'x-internal-service-token',
];

/**
 * Express middleware that strips all client-supplied downstream/internal headers
 * on incoming requests to prevent spoofing.
 */
export function stripInboundGatewayHeaders(req, res, next) {
  if (req?.headers) {
    for (const key of Object.keys(req.headers)) {
      const lower = key.toLowerCase();
      if (lower.startsWith('x-user-') || STRIP_HEADER_NAMES.includes(lower)) {
        delete req.headers[key];
      }
    }
  }
  if (next) next();
}

/** Injects the shared gateway secret (required by downstream requireInternalRequest). */
export function attachInternalServiceToken(proxyReq, token = process.env.INTERNAL_SERVICE_TOKEN) {
  if (token) {
    proxyReq.setHeader('x-internal-service-token', token);
  }
}

/**
 * Strips any incoming spoofed headers on the proxyReq object.
 */
export function sanitizeProxyHeaders(proxyReq) {
  if (!proxyReq) return;

  const removeHeader = (name) => {
    if (typeof proxyReq.removeHeader === 'function') {
      proxyReq.removeHeader(name);
    } else if (proxyReq.headers && typeof proxyReq.headers === 'object') {
      delete proxyReq.headers[name.toLowerCase()];
      delete proxyReq.headers[name];
    }
  };

  const currentHeaders = typeof proxyReq.getRawHeaderNames === 'function'
    ? proxyReq.getRawHeaderNames()
    : (typeof proxyReq.getHeaders === 'function' ? Object.keys(proxyReq.getHeaders()) : Object.keys(proxyReq.headers || {}));

  for (const h of currentHeaders) {
    const lower = h.toLowerCase();
    if (lower.startsWith('x-user-') || STRIP_HEADER_NAMES.includes(lower)) {
      removeHeader(h);
    }
  }
}

/**
 * Forward authenticated user context + RBAC envelope to downstream microservices.
 * Always strips client-supplied headers and attaches the internal service token.
 */
export function attachDownstreamHeaders(proxyReq, req) {
  sanitizeProxyHeaders(proxyReq);
  attachInternalServiceToken(proxyReq);
  if (!req?.user) return;

  proxyReq.setHeader('x-user-id', req.user.id);
  proxyReq.setHeader('x-tenant-id', req.user.tenantId);
  if (req.user.departmentId) proxyReq.setHeader('x-department-id', req.user.departmentId);
  if (req.user.email) proxyReq.setHeader('x-user-email', req.user.email);
  proxyReq.setHeader('x-must-change-password', req.user.mustChangePassword ? 'true' : 'false');

  const roleIds = req.rbacEnvelope?.roleIds;
  if (Array.isArray(roleIds)) {
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
