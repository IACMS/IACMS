/**
 * Live password policy from auth-service so gateway session/JWT cannot stay stale
 * after a successful change-password flow.
 */

export async function fetchMustChangePasswordFromAuth(userId, tenantId, authUrl) {
  const base = authUrl || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-user-id': String(userId),
      'x-tenant-id': String(tenantId),
    };
    if (process.env.INTERNAL_SERVICE_TOKEN) {
      headers['x-internal-service-token'] = process.env.INTERNAL_SERVICE_TOKEN;
    }
    const r = await fetch(`${base.replace(/\/$/, '')}/auth/password-status`, {
      headers,
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data.mustChangePassword === 'boolean' ? data.mustChangePassword : null;
  } catch {
    return null;
  }
}
