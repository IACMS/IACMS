import * as jose from 'jose';
import jwt from 'jsonwebtoken';
import { ValidationError, UnauthorizedError } from '../../../../shared/common/errors.js';

let localJwks = null;
let lastJwksJson = null;
let remoteJwks = null;

function getJwks() {
  if (process.env.OIDC_JWKS_JSON && process.env.OIDC_JWKS_JSON !== lastJwksJson) {
    try {
      lastJwksJson = process.env.OIDC_JWKS_JSON;
      localJwks = jose.createLocalJWKSet(JSON.parse(process.env.OIDC_JWKS_JSON));
    } catch (e) {
      console.warn('[chat-auth] OIDC_JWKS_JSON parse error:', e.message);
    }
  }
  if (localJwks) return localJwks;

  if (!remoteJwks) {
    const issuer = process.env.OIDC_ISSUER || 'http://localhost:3001';
    const jwksUri = process.env.OIDC_JWKS_URI || `${issuer.replace(/\/$/, '')}/oauth/jwks`;
    remoteJwks = jose.createRemoteJWKSet(new URL(jwksUri), {
      cacheMaxAge: 3600000,
      cooldownDuration: 30000,
    });
  }
  return remoteJwks;
}

/**
 * Extracts actor identity from API Gateway injected headers.
 */
export function actorFromHeaders(req) {
  const tenantId = req.headers['x-tenant-id'];
  const userId = req.headers['x-user-id'];
  
  if (!tenantId || !userId) {
    throw new ValidationError('Missing identity headers (x-tenant-id or x-user-id)');
  }
  
  return { 
    tenantId: String(tenantId), 
    userId: String(userId), 
    departmentId: req.headers['x-department-id'] ? String(req.headers['x-department-id']) : null 
  };
}

/**
 * Express middleware to attach actor to request object.
 * Supports:
 *   1. Gateway-injected headers (x-tenant-id, x-user-id).
 *   2. Direct OAuth 2.0 / OIDC Bearer tokens (RS256 JWT validated offline against JWKS).
 *   3. Legacy JWT tokens (HS256).
 */
export async function attachActor(req, res, next) {
  const tenantId = req.headers['x-tenant-id'];
  const userId = req.headers['x-user-id'];

  if (tenantId && userId) {
    try {
      req.actor = actorFromHeaders(req);
      req.user = req.actor;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const issuer = process.env.OIDC_ISSUER || 'http://localhost:3001';
        const verifyOptions = { issuer };
        if (process.env.SERVICE_AUDIENCE) {
          verifyOptions.audience = process.env.SERVICE_AUDIENCE;
        }

        const { payload } = await jose.jwtVerify(token, getJwks(), verifyOptions);

        req.actor = {
          tenantId: payload.tenant_id,
          userId: payload.sub,
          departmentId: payload.department_id ?? null,
          email: payload.email ?? null,
          roles: Array.isArray(payload.roles) ? payload.roles : (payload.roles ? [payload.roles] : []),
          scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
          isApiKey: Boolean(payload.api_key_id),
        };

        req.user = req.actor;
        req.tenantId = payload.tenant_id;
        req.headers['x-tenant-id'] = payload.tenant_id;
        req.headers['x-user-id'] = payload.sub;
        if (payload.department_id) req.headers['x-department-id'] = payload.department_id;
        if (payload.roles) req.headers['x-user-roles'] = Array.isArray(payload.roles) ? payload.roles.join(',') : payload.roles;

        return next();
      } catch (oauthErr) {
        if (oauthErr.code === 'ERR_JWT_EXPIRED') {
          return next(new UnauthorizedError('Authentication token has expired'));
        }
        if (process.env.JWT_SECRET) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.actor = {
              tenantId: decoded.tenantId,
              userId: decoded.id || decoded.sub,
              departmentId: decoded.departmentId ?? null,
              email: decoded.email ?? null,
              roles: Array.isArray(decoded.roles) ? decoded.roles : [],
              scopes: typeof decoded.scope === 'string' ? decoded.scope.split(' ') : [],
            };
            req.user = req.actor;
            req.tenantId = decoded.tenantId;
            req.headers['x-tenant-id'] = decoded.tenantId;
            req.headers['x-user-id'] = decoded.id || decoded.sub;
            return next();
          } catch {
            return next(new UnauthorizedError('Invalid or expired token'));
          }
        }
        return next(new UnauthorizedError('Invalid or expired token'));
      }
    }
  }

  return next(new ValidationError('Missing identity headers (x-tenant-id or x-user-id)'));
}
