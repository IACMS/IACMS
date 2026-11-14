import { ForbiddenError } from '../../../../../shared/common/errors.js';

/** The API-key owner is the auditable actor for partner API mutations. */
export function requireApiKeyActor(context) {
  if (!context.apiKeyOwnerId) {
    throw new ForbiddenError('API key owner context is unavailable. Reauthenticate with the API key.');
  }
  return context.apiKeyOwnerId;
}
