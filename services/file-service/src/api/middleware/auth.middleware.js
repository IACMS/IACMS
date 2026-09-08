import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../../../../shared/common/errors.js';
import { resolveGatewayIdentity } from '../../../../../shared/middleware/gatewayIdentity.js';
import config from '../../config/index.js';
import prisma from '../../config/database.js';

/**
 * Authentication middleware for the File Service.
 *
 * 1. Gateway-forwarded headers — trusted when x-internal-service-token is valid
 *    (zero DB queries); verified against Postgres only in local dev direct access.
 * 2. JWT Bearer token — direct API calls without the gateway.
 */
export async function authenticateToken(req, res, next) {
  const userId = req.headers['x-user-id'];
  const tenantId = req.headers['x-tenant-id'];

  if (userId && tenantId) {
    try {
      const user = await resolveGatewayIdentity(prisma, req);
      if (!user) {
        return next(new UnauthorizedError('Invalid forwarded identity'));
      }
      req.user = user;
      return next();
    } catch (err) {
      return next(err);
    }
  }

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
