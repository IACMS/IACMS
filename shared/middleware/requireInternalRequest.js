/**
 * Blocks direct HTTP access to internal microservices in production.
 * The API gateway attaches `x-internal-service-token` on every proxied request.
 *
 * When INTERNAL_SERVICE_TOKEN is unset and NODE_ENV !== 'production', requests
 * are allowed (local dev / direct service debugging).
 */

import { ForbiddenError } from '../common/errors.js';

const DEFAULT_SKIP = ['/health'];

export function requireInternalRequest(options = {}) {
  const skipPaths = options.skipPaths ?? DEFAULT_SKIP;

  return function internalRequestMiddleware(req, _res, next) {
    const path = req.path || req.url?.split('?')[0] || '';
    if (skipPaths.some((p) => path === p || path.startsWith(`${p}/`))) {
      return next();
    }

    const expected = process.env.INTERNAL_SERVICE_TOKEN;

    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        return next(
          new ForbiddenError('Service is misconfigured: INTERNAL_SERVICE_TOKEN is required in production'),
        );
      }
      return next();
    }

    const provided = req.headers['x-internal-service-token'];
    if (provided !== expected) {
      return next(new ForbiddenError('Direct service access is not allowed. Use the API gateway.'));
    }

    return next();
  };
}
