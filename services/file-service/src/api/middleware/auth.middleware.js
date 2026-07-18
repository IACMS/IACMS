import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../../../shared/common/errors.js';
import config from '../../config/index.js';

/**
 * Authentication middleware for the File Service.
 *
 * Supports two modes (matching the gateway pattern used by all IACMS services):
 *
 * 1. JWT Bearer token — direct API calls: `Authorization: Bearer <token>`
 * 2. Gateway-forwarded headers — when called via API Gateway:
 *    x-user-id, x-tenant-id, x-department-id, x-user-email, x-user-roles
 *
 * Populates req.user = { id, tenantId, departmentId, email, roles }
 */
export async function authenticateToken(req, res, next) {
  // Mode 1: JWT Bearer token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      req.user = {
        id: decoded.id || decoded.sub,
        tenantId: decoded.tenantId,
        departmentId: decoded.departmentId || null,
        email: decoded.email || null,
        roles: Array.isArray(decoded.roles) ? decoded.roles : [],
      };
      return next();
    } catch {
      return next(new UnauthorizedError('Invalid or expired token'));
    }
  }

  // Mode 2: Gateway-forwarded identity headers
  const userId = req.headers['x-user-id'];
  const tenantId = req.headers['x-tenant-id'];

  if (userId && tenantId) {
    req.user = {
      id: userId,
      tenantId,
      departmentId: req.headers['x-department-id'] || null,
      email: req.headers['x-user-email'] || null,
      roles: req.headers['x-user-roles']
        ? req.headers['x-user-roles'].split(',').map((r) => r.trim())
        : [],
    };
    return next();
  }

  return next(new UnauthorizedError('Authentication required. Provide a Bearer token or use the API gateway.'));
}
