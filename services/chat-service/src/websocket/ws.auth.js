import jwt from 'jsonwebtoken';

if (!process.env.JWT_SECRET) {
  throw new Error('[chat-ws-auth] JWT_SECRET environment variable is required. Generate with: openssl rand -base64 64');
}
const JWT_SECRET = process.env.JWT_SECRET;


/**
 * Authenticate a WebSocket connection from the initial HTTP upgrade request.
 * 
 * The client sends the JWT as either:
 *   - A query parameter: ws://host:port/ws?token=<jwt>
 *   - A sub-protocol:    Sec-WebSocket-Protocol: access_token, <jwt>
 *
 * Returns the decoded user payload or null if invalid.
 */
export function authenticateWsRequest(req) {
  try {
    let token = null;

    // 1. Try query param
    const url = new URL(req.url, `http://${req.headers.host}`);
    token = url.searchParams.get('token');

    // 2. Fall back to sub-protocol header
    if (!token) {
      const protocols = req.headers['sec-websocket-protocol'];
      if (protocols) {
        const parts = protocols.split(',').map((s) => s.trim());
        // Convention: ["access_token", "<actual-jwt>"]
        const tokenIndex = parts.indexOf('access_token');
        if (tokenIndex !== -1 && parts[tokenIndex + 1]) {
          token = parts[tokenIndex + 1];
        }
      }
    }

    if (!token) return null;

    const payload = jwt.verify(token, JWT_SECRET);
    return {
      userId: payload.id,
      tenantId: payload.tenantId,
      departmentId: payload.departmentId || null,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
    };
  } catch (error) {
    console.warn('[ws-auth] JWT verification failed:', error.message);
    return null;
  }
}
