/**
 * Authentication Middleware for API Gateway
 * Supports dual authentication: Session-based (cookies) and JWT (tokens)
 * 
 * Priority:
 * 1. Session authentication (for web browsers)
 * 2. JWT authentication (for API clients)
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';

/**
 * Public routes that don't require authentication
 * Note: Paths are relative to the /api/v1 mount point
 */
const PUBLIC_ROUTES = [
  // Auth service routes
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/register' },
  { method: 'POST', path: '/auth/refresh' },
  // Session routes (handled at gateway level)
  { method: 'POST', path: '/session/login' },
  // Tenant validation
  { method: 'GET', path: '/tenants/validate' },
];

/**
 * Check if a route is public
 */
function isPublicRoute(method, path) {
  return PUBLIC_ROUTES.some(route => {
    if (route.method !== method) return false;
    // Exact match or prefix match (for paths like /tenants/validate/:code)
    return path === route.path || path.startsWith(route.path + '/');
  });
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * Set user context headers for downstream services
 */
function setUserHeaders(req, user) {
  req.headers['x-user-id'] = user.id;
  req.headers['x-tenant-id'] = user.tenantId;
  req.headers['x-user-email'] = user.email;
  if (user.firstName) req.headers['x-user-firstname'] = user.firstName;
  if (user.lastName) req.headers['x-user-lastname'] = user.lastName;
}

/**
 * Validate JWT token and return decoded payload
 */
function validateJwtToken(token) {
  try {
    return { valid: true, payload: jwt.verify(token, JWT_SECRET) };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'TOKEN_EXPIRED', message: 'Authentication token has expired' };
    }
    return { valid: false, error: 'INVALID_TOKEN', message: 'Invalid authentication token' };
  }
}

/**
 * Authentication middleware
 * Checks session first, then falls back to JWT
 */
export function authenticate(req, res, next) {
  // Skip authentication for public routes
  if (isPublicRoute(req.method, req.path)) {
    return next();
  }

  // Strategy 1: Check for valid session (web browser authentication)
  if (req.session && req.session.user) {
    const sessionUser = req.session.user;
    
    // Attach user to request
    req.user = {
      id: sessionUser.id,
      tenantId: sessionUser.tenantId,
      email: sessionUser.email,
      firstName: sessionUser.firstName,
      lastName: sessionUser.lastName,
    };
    req.authMethod = 'session';
    
    // Set headers for downstream services
    setUserHeaders(req, req.user);
    
    // Touch session to extend expiry (rolling session)
    req.session.lastAccessed = new Date().toISOString();
    
    return next();
  }

  // Strategy 2: Fall back to JWT token (API client authentication)
  const token = extractBearerToken(req);
  
  if (token) {
    const result = validateJwtToken(token);
    
    if (result.valid) {
      const decoded = result.payload;
      
      // Attach user to request
      req.user = {
        id: decoded.id,
        tenantId: decoded.tenantId,
        email: decoded.email,
      };
      req.authMethod = 'jwt';
      
      // Set headers for downstream services
      setUserHeaders(req, req.user);
      
      return next();
    }
    
    // Token provided but invalid
    return res.status(401).json({
      error: {
        code: result.error,
        message: result.message,
      },
    });
  }

  // No authentication provided
  return res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a valid session cookie or Bearer token.',
    },
  });
}

/**
 * Optional authentication middleware
 * Validates session/token if present, but doesn't require it
 */
export function optionalAuth(req, res, next) {
  // Try session first
  if (req.session && req.session.user) {
    const sessionUser = req.session.user;
    req.user = {
      id: sessionUser.id,
      tenantId: sessionUser.tenantId,
      email: sessionUser.email,
      firstName: sessionUser.firstName,
      lastName: sessionUser.lastName,
    };
    req.authMethod = 'session';
    setUserHeaders(req, req.user);
    return next();
  }

  // Try JWT
  const token = extractBearerToken(req);
  if (token) {
    const result = validateJwtToken(token);
    if (result.valid) {
      const decoded = result.payload;
      req.user = {
        id: decoded.id,
        tenantId: decoded.tenantId,
        email: decoded.email,
      };
      req.authMethod = 'jwt';
      setUserHeaders(req, req.user);
    }
  }

  // Continue regardless of authentication status
  next();
}

/**
 * Require specific authentication method
 * Use when you need to enforce session-only or JWT-only auth
 */
export function requireAuthMethod(method) {
  return (req, res, next) => {
    if (req.authMethod !== method) {
      return res.status(401).json({
        error: {
          code: 'INVALID_AUTH_METHOD',
          message: `This endpoint requires ${method} authentication`,
        },
      });
    }
    next();
  };
}

export default authenticate;
