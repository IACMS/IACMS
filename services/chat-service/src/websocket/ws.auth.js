import jwt from 'jsonwebtoken';
import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-chat-testing-only-at-least-32-chars';

let localJwks = null;
let lastJwksJson = null;
let remoteJwks = null;

function getJwks() {
  if (process.env.OIDC_JWKS_JSON && process.env.OIDC_JWKS_JSON !== lastJwksJson) {
    try {
      lastJwksJson = process.env.OIDC_JWKS_JSON;
      localJwks = jose.createLocalJWKSet(JSON.parse(process.env.OIDC_JWKS_JSON));
    } catch (e) {
      console.warn('[chat-ws-auth] OIDC_JWKS_JSON parse error:', e.message);
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
 * Extract token from WebSocket upgrade request (query param or Sec-WebSocket-Protocol).
 */
export function extractWsToken(req) {
  try {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    if (token) return token;

    const protocols = req.headers?.['sec-websocket-protocol'];
    if (protocols) {
      const parts = protocols.split(',').map((s) => s.trim());
      const tokenIndex = parts.indexOf('access_token');
      if (tokenIndex !== -1 && parts[tokenIndex + 1]) {
        return parts[tokenIndex + 1];
      }
    }
  } catch {
    // Malformed URL or headers
  }
  return null;
}

/**
 * Synchronous WebSocket authentication (legacy HS256 secret).
 * Preserves compatibility with existing synchronous callers and tests.
 */
export function authenticateWsRequest(req) {
  try {
    const token = extractWsToken(req);
    if (!token) return null;

    const payload = jwt.verify(token, JWT_SECRET);
    return {
      userId: payload.id || payload.sub,
      tenantId: payload.tenantId || payload.tenant_id,
      departmentId: payload.departmentId || payload.department_id || null,
      email: payload.email || null,
      firstName: payload.firstName || payload.first_name || null,
      lastName: payload.lastName || payload.last_name || null,
    };
  } catch (error) {
    console.warn('[ws-auth] JWT verification failed:', error.message);
    return null;
  }
}

/**
 * Asynchronous WebSocket authentication (OIDC RS256 JWKS + legacy fallback).
 * Used by the WebSocket server to accept standard RS256 Bearer tokens from external clients.
 */
export async function authenticateWsRequestAsync(req) {
  const token = extractWsToken(req);
  if (!token) return null;

  try {
    const issuer = process.env.OIDC_ISSUER || 'http://localhost:3001';
    const verifyOptions = { issuer };
    if (process.env.SERVICE_AUDIENCE) {
      verifyOptions.audience = process.env.SERVICE_AUDIENCE;
    }

    const { payload } = await jose.jwtVerify(token, getJwks(), verifyOptions);
    return {
      userId: payload.sub,
      tenantId: payload.tenant_id,
      departmentId: payload.department_id || null,
      email: payload.email || null,
      firstName: payload.first_name || null,
      lastName: payload.last_name || null,
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
      isApiKey: Boolean(payload.api_key_id),
    };
  } catch {
    // Fall back to legacy synchronous HS256 verification
    return authenticateWsRequest(req);
  }
}
