import { ValidationError } from '../../../../shared/common/errors.js';

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
 */
export function attachActor(req, res, next) {
  try {
    req.actor = actorFromHeaders(req);
    next();
  } catch (error) {
    next(error);
  }
}
