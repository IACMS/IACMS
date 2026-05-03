/**
 * Shared test helpers for auth-service integration tests.
 *
 * Each integration test file:
 *   1. Imports constants and helper functions from here.
 *   2. Sets up its own Prisma + Redis connections.
 *   3. Calls resetAdminPassword() + clearRedisLockout() in its own beforeAll.
 */

import bcrypt from 'bcryptjs';

// ── Seeded constants ──────────────────────────────────────────────────────────
export const ADMIN_EMAIL    = 'admin@test-org.com';
export const ADMIN_PASSWORD = 'password123';
export const TENANT_CODE    = 'TEST-ORG';
/** Tenant-scoped org administrator (seed UUID unchanged). */
export const TENANT_ADMIN_ROLE_ID = '55555555-5555-5555-5555-555555555555';
/** @deprecated Use TENANT_ADMIN_ROLE_ID */
export const ADMIN_ROLE_ID = TENANT_ADMIN_ROLE_ID;
export const SYSTEM_ADMIN_ROLE_ID = '99999999-9999-9999-9999-999999999991';
export const NONEXISTENT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/**
 * Login helper — wraps POST /auth/login with the default tenant.
 */
export function makeLoginHelper(app, request) {
  return (email, password) =>
    request(app)
      .post('/auth/login')
      .send({ email, password, tenantCode: TENANT_CODE });
}

/**
 * Reset a user's password to a known hash (for test isolation between runs).
 */
export async function resetAdminPassword(prisma) {
  const freshHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.user.updateMany({
    where: { email: ADMIN_EMAIL },
    data: { passwordHash: freshHash, mustChangePassword: false },
  });
}

/**
 * Clear Redis lockout keys for a given email.
 */
export async function clearRedisLockout(redis, email) {
  await redis.del(`auth:lockout:${email}`, `auth:attempts:${email}`);
}

/**
 * Delete test users created during a test run.
 */
export async function cleanupUsers(prisma, emails) {
  if (!emails.length) return;
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
}
