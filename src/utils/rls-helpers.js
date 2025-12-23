import prisma, { setTenantContext, setSuperAdminContext } from '../config/database.js';

/**
 * Set tenant context for a database transaction
 * This is useful for background jobs or operations outside of HTTP requests
 */
export async function setTenantContextHelper(tenantId, userId = null) {
  await setTenantContext(tenantId, userId);
}

/**
 * Set super admin context (bypasses RLS)
 * Use with extreme caution
 */
export async function setSuperAdminContextHelper() {
  await setSuperAdminContext();
}

/**
 * Reset RLS context
 */
export async function resetRLSContext() {
  await prisma.$executeRaw`RESET app.current_tenant_id`;
  await prisma.$executeRaw`RESET app.current_user_id`;
  await prisma.$executeRaw`RESET app.is_super_admin`;
}

/**
 * Execute a query with tenant context
 */
export async function withTenantContext(tenantId, userId, callback) {
  try {
    await setTenantContext(tenantId, userId);
    const result = await callback();
    await resetRLSContext();
    return result;
  } catch (error) {
    await resetRLSContext();
    throw error;
  }
}
