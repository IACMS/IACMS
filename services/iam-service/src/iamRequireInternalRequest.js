import { ForbiddenError } from './iamErrors.js';

const DEFAULT_SKIP = ['/health'];

/** Permit IAM's current gateway path, while rejecting direct production access. */
export function requireInternalRequest(options = {}) {
  const skipPaths = options.skipPaths ?? DEFAULT_SKIP;
  const allowOAuthBearer = options.allowOAuthBearer ?? false;
  return function internalRequestMiddleware(req, _res, next) {
    const path = req.path || req.url?.split('?')[0] || '';
    if (skipPaths.some((item) => path === item || path.startsWith(`${item}/`))) return next();
    if (allowOAuthBearer && req.headers.authorization?.startsWith('Bearer ')) return next();
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected) {
      if (process.env.NODE_ENV === 'production') return next(new ForbiddenError('Service is misconfigured: INTERNAL_SERVICE_TOKEN is required in production'));
      return next();
    }
    if (req.headers['x-internal-service-token'] !== expected) {
      return next(new ForbiddenError('Direct service access is not allowed. Use the API gateway.'));
    }
    return next();
  };
}
