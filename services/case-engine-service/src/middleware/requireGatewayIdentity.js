/**
 * Ensures proxied gateway identity headers are present.
 * Clients must hit the API gateway — direct access without headers is denied.
 */

import { UnauthorizedError } from '../../../../shared/common/errors.js';

export function requireGatewayIdentity(req, res, next) {
  const tenantId = req.headers['x-tenant-id'];
  const userId = req.headers['x-user-id'];
  if (!tenantId || !userId) {
    return next(
      new UnauthorizedError('Tenant ID and User ID are required (use API gateway)')
    );
  }
  next();
}
