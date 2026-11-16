/**
 * Blocks direct HTTP access to internal microservices in production.
 * The API gateway attaches `x-internal-service-token` on every proxied request.
 *
 * When allowOAuthBearer is true, direct calls with an `Authorization: Bearer <token>`
 * header are permitted to reach the service's OAuth resource server verification middleware.
 *
 * When INTERNAL_SERVICE_TOKEN is unset and NODE_ENV !== 'production', requests
 * are allowed (local dev / direct service debugging).
 */

import crypto from 'node:crypto';
import { ForbiddenError } from '../common/errors.js';

function timingSafeMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

const DEFAULT_SKIP = ['/health'];

export function requireInternalRequest(options = {}) {
  const skipPaths = options.skipPaths ?? DEFAULT_SKIP;
  const allowOAuthBearer = options.allowOAuthBearer ?? false;

  return function internalRequestMiddleware(req, _res, next) {
    const path = req.path || req.url?.split('?')[0] || '';
    if (skipPaths.some((p) => path === p || path.startsWith(`${p}/`))) {
      return next();
    }

    if (allowOAuthBearer && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
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
    if (!timingSafeMatch(provided, expected)) {
      return next(new ForbiddenError('Direct service access is not allowed. Use the API gateway.'));
    }

    return next();
  };
}
