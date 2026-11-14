import { AppError } from '../../../../shared/common/errors.js';

const timeoutMs = Number(process.env.IAM_API_TIMEOUT_MS || 5000);

export async function updateIamIdentity({ userId, tenantId, fields }) {
  return callIam(`/internal/identities/${encodeURIComponent(userId)}`, tenantId, fields);
}

export async function setIamIdentityActive({ userId, tenantId, isActive }) {
  return callIam(`/internal/identities/${encodeURIComponent(userId)}/active`, tenantId, { isActive });
}

/** Create a credential-bearing IAM account for a caller that passed IACMS RBAC. */
export async function createIamUser({ actorId, tenantId, fields }) {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  const baseUrl = (process.env.IAM_SERVICE_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/$/, '');
  if (!token) throw new AppError('IAM service credentials are not configured', 503, 'IAM_UNAVAILABLE');

  let response;
  try {
    response = await fetch(`${baseUrl}/auth/users/create`, {
      method: 'POST',
      headers: {
        'x-internal-service-token': token,
        'x-user-id': String(actorId),
        'x-tenant-id': String(tenantId),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      // IAM owns credentials and onboarding delivery. IACMS owns department
      // details and role assignment, so neither crosses this boundary.
      body: JSON.stringify({ ...fields, tenantId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError('IAM service is unavailable for account provisioning', 503, 'IAM_UNAVAILABLE');
  }

  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload.user;
  if (response.status >= 500) throw new AppError('IAM service failed while provisioning the account', 503, 'IAM_UNAVAILABLE');
  throw new AppError(
    payload?.error?.message || payload?.message || 'IAM account provisioning failed',
    response.status,
    payload?.error?.code || 'IAM_PROVISIONING_ERROR',
  );
}

async function callIam(path, tenantId, body) {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  const baseUrl = (process.env.IAM_SERVICE_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/$/, '');
  if (!token) throw new AppError('IAM service credentials are not configured', 503, 'IAM_UNAVAILABLE');

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'x-internal-service-token': token,
        'x-tenant-id': String(tenantId),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError('IAM service is unavailable for identity operations', 503, 'IAM_UNAVAILABLE');
  }

  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload.user;
  if (response.status === 404) throw new AppError('User not found', 404, 'NOT_FOUND');
  if (response.status >= 500) throw new AppError('IAM service failed while handling identity operation', 503, 'IAM_UNAVAILABLE');
  throw new AppError(payload?.error?.message || payload?.message || 'IAM identity update failed', response.status, payload?.error?.code || 'IAM_IDENTITY_ERROR');
}
