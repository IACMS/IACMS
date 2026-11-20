import { ForbiddenError } from '../../../../shared/common/errors.js';

export function requireScope(requiredScope) {
  return (req, res, next) => {
    if (!req.apiKeyContext) return next(new ForbiddenError('API key required'));
    const hasScope = req.apiKeyContext.scopes.some(s => s === requiredScope || s === '*');
    if (!hasScope) return next(new ForbiddenError(`API key lacks required scope: ${requiredScope}`));
    next();
  };
}

export function scopeForEntity(entity, operation) {
  if (operation === 'query' || operation === 'read') {
    return `${entity}:read`;
  }
  if (operation.startsWith('mutate:create')) {
    return `${entity}:create`;
  }
  if (operation.startsWith('mutate:update')) {
    return `${entity}:update`;
  }
  if (operation.startsWith('mutate:delete')) {
    return `${entity}:delete`;
  }
  
  return `${entity}:${operation}`;
}
