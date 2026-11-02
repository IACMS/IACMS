import jwt from 'jsonwebtoken';
import * as jose from 'jose';
import { UnauthorizedError } from '../../../../../shared/common/errors.js';
import { resolveGatewayIdentity } from '../../../../../shared/middleware/gatewayIdentity.js';
import config from '../../config/index.js';
import prisma from '../../config/database.js';

let localJwks = null;
let lastJwksJson = null;
let remoteJwks = null;

function getJwks() {
  if (process.env.OIDC_JWKS_JSON && process.env.OIDC_JWKS_JSON !== lastJwksJson) {
    try {
      lastJwksJson = process.env.OIDC_JWKS_JSON;
      localJwks = jose.createLocalJWKSet(JSON.parse(process.env.OIDC_JWKS_JSON));
    } catch (e) {
      console.warn('[file-service-auth] OIDC_JWKS_JSON parse error:', e.message);
    }
  }
  if (localJwks) return localJwks;

  if (!remoteJwks) {
    const issuer = process.env.OIDC_ISSUER || config.auth?.authServiceUrl || 'http://localhost:3001';
    const jwksUri = process.env.OIDC_JWKS_URI || `${issuer.replace(/\/$/, '')}/oauth/jwks`;
    remoteJwks = jose.createRemoteJWKSet(new URL(jwksUri), {
      cacheMaxAge: 3600000,
      cooldownDuration: 30000,
    });
  }
  return remoteJwks;
}

/**
 * Authentication middleware for the File Service (Resource Server).
 *
 * 1. Gateway-forwarded headers — trusted when x-internal-service-token is valid
 *    (zero DB queries); verified against Postgres in local dev direct access.
 * 2. OAuth 2.0 / OIDC Bearer token (RS256) — verified offline against IAM's public JWKS.
 * 3. Legacy JWT Bearer token (HS256) — verified with JWT_SECRET for backward compatibility.
 */
export async function authenticateToken(req, res, next) {
  const userId = req.headers['x-user-id'];
  const tenantId = req.headers['x-tenant-id'];

  // 1. Gateway-forwarded identity path
  if (userId && tenantId) {
    try {
      const user = await resolveGatewayIdentity(prisma, req);
      if (!user) {
        return next(new UnauthorizedError('Invalid forwarded identity'));
      }
      req.user = user;
      req.tenantId = user.tenantId;
      return next();
    } catch (err) {
      return next(err);
    }
  }

  // 2. Direct Bearer token path
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (token) {
    // Attempt OAuth 2.0 / OIDC RS256 verification first
    try {
      const issuer = process.env.OIDC_ISSUER || config.auth?.authServiceUrl || 'http://localhost:3001';
      const verifyOptions = { issuer };
      const expectedAudience = process.env.SERVICE_AUDIENCE || 'https://files.iacms.gov/api';
      
      // We accept either the file-service audience, the gateway audience, or no audience check if unconfigured
      if (process.env.SERVICE_AUDIENCE) {
        verifyOptions.audience = expectedAudience;
      }

      const { payload } = await jose.jwtVerify(token, getJwks(), verifyOptions);

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
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
        isApiKey: Boolean(payload.api_key_id),
        apiKeyId: payload.api_key_id ?? null,
      };

      req.tenantId = payload.tenant_id;
      req.headers['x-user-id'] = payload.sub;
      if (payload.tenant_id) req.headers['x-tenant-id'] = payload.tenant_id;
      if (roles.length > 0) req.headers['x-user-roles'] = roles.join(',');
      if (payload.api_key_id) req.headers['x-api-key-id'] = payload.api_key_id;

      return next();
    } catch (oauthErr) {
      // If token is expired, reject immediately
      if (oauthErr.code === 'ERR_JWT_EXPIRED') {
        return next(new UnauthorizedError('Authentication token has expired'));
      }

      // Fallback: Legacy HS256 secret verification
      try {
        const decoded = jwt.verify(token, config.auth.jwtSecret);
        req.user = {
          id: decoded.id || decoded.sub,
          tenantId: decoded.tenantId,
          departmentId: decoded.departmentId || null,
          email: decoded.email || null,
          roles: Array.isArray(decoded.roles) ? decoded.roles : [],
          permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
          scopes: typeof decoded.scope === 'string' ? decoded.scope.split(' ') : [],
        };
        req.tenantId = decoded.tenantId;
        return next();
      } catch {
        return next(new UnauthorizedError('Invalid or expired token'));
      }
    }
  }

  return next(new UnauthorizedError('Authentication required. Provide a Bearer token or use the API gateway.'));
}
