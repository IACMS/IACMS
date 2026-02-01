/**
 * Authentication Middleware for API Gateway
 * Validates JWT tokens and extracts user information
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';

/**
 * Public routes that don't require authentication
 * Note: Paths are relative to the /api/v1 mount point
 */
const PUBLIC_ROUTES = [
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/register' },
  { method: 'POST', path: '/auth/refresh' },
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
 * Authentication middleware
 * Validates JWT token and attaches user info to request
 */
export function authenticate(req, res, next) {
  // Skip authentication for public routes
  if (isPublicRoute(req.method, req.path)) {
    return next();
  }

  // Get token from Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token required',
      },
    });
  }

  try {
    // Verify and decode token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Attach user info to request
    req.user = {
      id: decoded.id,
      tenantId: decoded.tenantId,
      email: decoded.email,
    };

    // Forward user info to downstream services via headers
    req.headers['x-user-id'] = decoded.id;
    req.headers['x-tenant-id'] = decoded.tenantId;
    req.headers['x-user-email'] = decoded.email;

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Authentication token has expired',
        },
      });
    }

    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
      },
    });
  }
}

/**
 * Optional authentication middleware
 * Validates token if present, but doesn't require it
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      tenantId: decoded.tenantId,
      email: decoded.email,
    };
    req.headers['x-user-id'] = decoded.id;
    req.headers['x-tenant-id'] = decoded.tenantId;
    req.headers['x-user-email'] = decoded.email;
  } catch (error) {
    // Token invalid but optional, continue without user
  }

  next();
}

export default authenticate;
