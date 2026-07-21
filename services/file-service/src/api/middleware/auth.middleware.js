import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../../../../shared/common/errors.js';
import config from '../../config/index.js';

function splitHeaderList(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

/**
 * Authentication middleware for the File Service.
 *
 * Supports two modes (matching the gateway pattern used by all IACMS services):
 *
 * 1. Gateway-forwarded headers — preferred when present. The gateway attaches
 *    RBAC permissions on `x-user-permissions`; JWTs do not carry permissions.
 * 2. JWT Bearer token — direct API calls without the gateway.
 *
 * Populates req.user = { id, tenantId, departmentId, email, roles, permissions }
 */
export async function authenticateToken(req, res, next) {
  // Mode 1: Gateway-forwarded identity (permissions come from RBAC, not the JWT)
  const userId = req.headers['x-user-id'];
  const tenantId = req.headers['x-tenant-id'];

  if (userId && tenantId) {
    req.user = {
      id: userId,
      tenantId,
      departmentId: req.headers['x-department-id'] || null,
      email: req.headers['x-user-email'] || null,
      roles: splitHeaderList(req.headers['x-user-roles']),
      permissions: splitHeaderList(req.headers['x-user-permissions']),
    };
    return next();
  }

  // Mode 2: JWT Bearer token (direct calls — no RBAC permission list unless embedded)
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
        permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
      };
      return next();
    } catch {
      return next(new UnauthorizedError('Invalid or expired token'));
    }
  }

  return next(new UnauthorizedError('Authentication required. Provide a Bearer token or use the API gateway.'));
}
