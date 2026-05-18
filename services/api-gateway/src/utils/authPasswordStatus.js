/**
 * Live password policy from auth-service so gateway session/JWT cannot stay stale
 * after a successful change-password flow.
 */

export async function fetchMustChangePasswordFromAuth(userId, tenantId, authUrl) {
  const base = authUrl || process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/auth/password-status`, {
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': String(userId),
        'x-tenant-id': String(tenantId),
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data.mustChangePassword === 'boolean' ? data.mustChangePassword : null;
  } catch {
    return null;
  }
}
