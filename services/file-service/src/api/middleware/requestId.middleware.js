import { v4 as uuidv4 } from 'uuid';

/**
 * Attaches a unique request ID to every request.
 * Uses x-request-id header if provided by the caller, otherwise generates a new UUID.
 * The ID is echoed back in the response header for client-side tracing.
 */
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('x-request-id', req.id);
  next();
}
