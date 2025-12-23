import prisma from '../config/database.js';

/**
 * User Model
 * Provides methods to interact with the users table
 */
class User {
  /**
   * Find user by ID
   * @param {string} id - User UUID
   * @returns {Promise<Object|null>} User object or null
   */
  static async findById(id) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        tenant: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Find user by email within a tenant
   * @param {string} email - User email
   * @param {string} tenantId - Tenant UUID
   * @returns {Promise<Object|null>} User object or null
   */
  static async findByEmail(email, tenantId) {
    return prisma.user.findFirst({
      where: {
        email,
        tenantId,
      },
      include: {
        tenant: true,
      },
    });
  }

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created user
   */
  static async create(userData) {
    return prisma.user.create({
      data: userData,
      include: {
        tenant: true,
      },
    });
  }

  /**
   * Update user
   * @param {string} id - User UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated user
   */
  static async update(id, updates) {
    return prisma.user.update({
      where: { id },
      data: updates,
      include: {
        tenant: true,
      },
    });
  }

  /**
   * Get users by tenant
   * @param {string} tenantId - Tenant UUID
   * @param {Object} filters - Additional filters
   * @returns {Promise<Array>} Array of users
   */
  static async findByTenant(tenantId, filters = {}) {
    return prisma.user.findMany({
      where: {
        tenantId,
        ...filters,
      },
      include: {
        tenant: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get user with permissions
   * @param {string} id - User UUID
   * @returns {Promise<Object|null>} User with roles and permissions
   */
  static async findWithPermissions(id) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          where: {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}

export default User;

