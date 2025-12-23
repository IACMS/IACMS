import prisma, { setTenantContext, setSuperAdminContext } from '../config/database.js';

/**
 * Middleware to set tenant context for Row Level Security
 * This sets the current_tenant_id in the PostgreSQL session
 * which is used by RLS policies to filter data
 */
export const setTenantContextMiddleware = async (req, res, next) => {
  try {
    // Extract tenant_id from JWT token, header, or subdomain
    // For now, we'll get it from req.user (set by auth middleware)
    const tenantId = req.user?.tenant_id || req.headers['x-tenant-id'];

    if (tenantId) {
      // Set the tenant_id in the PostgreSQL session for RLS
      await setTenantContext(tenantId, req.user?.id);
      req.tenantId = tenantId;
    }

    next();
  } catch (error) {
    console.error('Error setting tenant context:', error);
    next(error);
  }
};

/**
 * Middleware to set super admin context (bypasses RLS)
 * Use with caution - only for system-wide operations
 */
export const setSuperAdminContextMiddleware = async (req, res, next) => {
  try {
    await setSuperAdminContext();
    next();
  } catch (error) {
    console.error('Error setting super admin context:', error);
    next(error);
  }
};

// Re-export helpers for convenience
export { setTenantContext, setSuperAdminContext };
