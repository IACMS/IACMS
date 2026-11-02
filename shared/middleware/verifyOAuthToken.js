/**
 * verifyOAuthToken.js
 * Universal OAuth 2.0 / OIDC RS256 Bearer Token Verification Middleware.
 *
 * Allows any independent service (File Management, Chat, Audit, Notification, etc.)
 * or external agency gateway to authenticate requests offline via IAM's public JWKS.
 *
 * Supports Dual-Access Mode:
 *   1. Direct OAuth 2.0 Bearer tokens (RS256 JWT validated offline against JWKS).
 *   2. Gateway-forwarded requests (when allowInternalToken: true and x-internal-service-token is valid).
 */

import * as jose from 'jose';

function checkScopeMatch(grantedScopes, requiredScope) {
  if (grantedScopes.includes('*')) return true;
  if (grantedScopes.includes(requiredScope)) return true;
  const [prefix] = requiredScope.split(':');
  if (prefix && grantedScopes.includes(`${prefix}:*`)) return true;
  return false;
}

export function createOAuthResourceServer({
  issuer = process.env.OIDC_ISSUER || 'http://localhost:3001',
  jwksUri = process.env.OIDC_JWKS_URI || `${(process.env.OIDC_ISSUER || 'http://localhost:3001').replace(/\/$/, '')}/oauth/jwks`,
  audience = null,
  requiredScopes = [],
  allowInternalToken = false,
} = {}) {
  let localJwks = null;
  let lastJwksJson = null;

  function getJwks() {
    if (process.env.OIDC_JWKS_JSON && process.env.OIDC_JWKS_JSON !== lastJwksJson) {
      try {
        lastJwksJson = process.env.OIDC_JWKS_JSON;
        localJwks = jose.createLocalJWKSet(JSON.parse(process.env.OIDC_JWKS_JSON));
      } catch (e) {
        console.warn('[oauth-resource-server] OIDC_JWKS_JSON parse error:', e.message);
      }
    }
    if (localJwks) return localJwks;

    if (!remoteJwks) {
      remoteJwks = jose.createRemoteJWKSet(new URL(jwksUri), {
        cacheMaxAge: 3600000,   // 1 hour key cache
        cooldownDuration: 30000, // 30 seconds cooldown
      });
    }
    return remoteJwks;
  }

  let remoteJwks = null;

  return async function authenticateResourceRequest(req, res, next) {
    // 1. Gateway internal token bypass / fast-path
    if (
      allowInternalToken &&
      process.env.INTERNAL_SERVICE_TOKEN &&
      req.headers['x-internal-service-token'] === process.env.INTERNAL_SERVICE_TOKEN
    ) {
      const headerUserId = req.headers['x-user-id'];
      const headerTenantId = req.headers['x-tenant-id'];
      if (headerUserId && headerTenantId) {
        const roles = req.headers['x-user-roles']
          ? req.headers['x-user-roles'].split(',').map((r) => r.trim()).filter(Boolean)
          : [];
        const permissions = req.headers['x-user-permissions']
          ? req.headers['x-user-permissions'].split(',').map((p) => p.trim()).filter(Boolean)
          : [];
        const scopes = req.headers['x-user-scopes']
          ? req.headers['x-user-scopes'].split(' ').map((s) => s.trim()).filter(Boolean)
          : [];

        req.user = {
          id: String(headerUserId),
          tenantId: String(headerTenantId),
          tenantCode: req.headers['x-tenant-code'] || null,
          departmentId: req.headers['x-department-id'] || null,
          email: req.headers['x-user-email'] || null,
          roles,
          permissions,
          scopes,
          isApiKey: Boolean(req.headers['x-api-key-id']),
          apiKeyId: req.headers['x-api-key-id'] || null,
        };
        req.tenantId = String(headerTenantId);
        return next();
      }
    }

    // 2. Direct Bearer token authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Bearer token required in Authorization header',
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Empty Bearer token provided',
      });
    }

    try {
      const verifyOptions = { issuer };
      if (audience) {
        verifyOptions.audience = audience;
      }

      const { payload } = await jose.jwtVerify(token, getJwks(), verifyOptions);

      // Verify required scopes
      if (requiredScopes && requiredScopes.length > 0) {
        const tokenScopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
        const hasAllRequired = requiredScopes.every((scope) => checkScopeMatch(tokenScopes, scope));

        if (!hasAllRequired) {
          return res.status(403).json({
            error: 'insufficient_scope',
            error_description: `Requires scope(s): ${requiredScopes.join(' ')}`,
          });
        }
      }

      const roles = Array.isArray(payload.roles)
        ? payload.roles
        : (payload.roles ? [payload.roles] : []);

      req.user = {
        id: payload.sub,
        tenantId: payload.tenant_id,
        tenantCode: payload.tenant_code ?? null,
        departmentId: payload.department_id ?? null,
        email: payload.email ?? null,
        roles,
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        isApiKey: Boolean(payload.api_key_id),
        apiKeyId: payload.api_key_id ?? null,
      };

      req.tenantId = payload.tenant_id;

      // Downstream header stamping
      req.headers['x-user-id'] = payload.sub;
      if (payload.tenant_id) req.headers['x-tenant-id'] = payload.tenant_id;
      if (roles.length > 0) req.headers['x-user-roles'] = roles.join(',');
      if (payload.api_key_id) req.headers['x-api-key-id'] = payload.api_key_id;

      return next();
    } catch (err) {
      const isExpired = err.code === 'ERR_JWT_EXPIRED';
      return res.status(401).json({
        error: isExpired ? 'token_expired' : 'invalid_token',
        error_description: isExpired ? 'Authentication token has expired' : err.message,
      });
    }
  };
}

/**
 * Route-level OAuth scope guard middleware.
 * Verifies that the authenticated user (or service API key) possesses the required scope.
 * Accepts wildcards ('*', 'files:*') and falls back to RBAC permissions/admin roles.
 */
export function requireOAuthScope(requiredScope) {
  return function scopeMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Authentication required',
      });
    }

    const scopes = Array.isArray(req.user.scopes) ? req.user.scopes : [];
    if (checkScopeMatch(scopes, requiredScope)) {
      return next();
    }

    // RBAC permissions fallback (for gateway-proxied requests)
    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (permissions.includes('*') || permissions.includes('admin:*') || permissions.includes(requiredScope)) {
      return next();
    }
    const [prefix] = requiredScope.split(':');
    if (prefix && permissions.includes(`${prefix}:*`)) {
      return next();
    }

    // Admin role override
    const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
    if (roles.includes('system_admin') || roles.includes('tenant_admin')) {
      return next();
    }

    return res.status(403).json({
      error: 'insufficient_scope',
      error_description: `Requires scope: ${requiredScope}`,
    });
  };
}

export default createOAuthResourceServer;
