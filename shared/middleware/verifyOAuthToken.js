/**
 * verifyOAuthToken.js
 * Universal OAuth 2.0 / OIDC RS256 Bearer Token Verification Middleware.
 *
 * Allows any independent service (File Management, Chat, Audit, Notification, etc.)
 * or external agency gateway to authenticate requests offline via IAM's public JWKS.
 */

import * as jose from 'jose';

export function createOAuthResourceServer({
  issuer = process.env.OIDC_ISSUER || 'http://localhost:3001',
  jwksUri = process.env.OIDC_JWKS_URI || `${(process.env.OIDC_ISSUER || 'http://localhost:3001').replace(/\/$/, '')}/oauth/jwks`,
  audience = null,
  requiredScopes = [],
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
        const hasUniversalScope = tokenScopes.includes('*');
        const hasAllRequired = hasUniversalScope || requiredScopes.every((scope) => tokenScopes.includes(scope));

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

export default createOAuthResourceServer;
