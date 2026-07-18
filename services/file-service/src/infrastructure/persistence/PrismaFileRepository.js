import prisma from '../../config/database.js';

/**
 * PrismaFileRepository — all database access for files and retention policies.
 *
 * Never expose storagePath in query results that go to controllers (except when needed internally).
 * The select projection in list() intentionally omits storagePath.
 */
export class PrismaFileRepository {
  /**
   * Create a new file metadata record.
   * @param {object} data
   * @returns {Promise<object>}
   */
  async create(data) {
    return await prisma.file.create({ data });
  }

  /**
   * Find a file by ID (excludes deleted files).
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    return await prisma.file.findFirst({
      where: { id, deleted: false },
    });
  }

  /**
   * Find a file by ID including deleted files (for admin / cleanup workers).
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findByIdRaw(id) {
    return await prisma.file.findUnique({ where: { id } });
  }

  /**
   * Update arbitrary fields on a file record.
   * @param {string} id
   * @param {object} data
   * @returns {Promise<object>}
   */
  async update(id, data) {
    return await prisma.file.update({ where: { id }, data });
  }

  /**
   * Soft-delete a file: sets deleted=true, status=DELETED, records scheduledDeleteAt.
   * @param {string} id
   * @param {{ scheduledDeleteAt?: Date|null }} opts
   * @returns {Promise<object>}
   */
  async softDelete(id, { scheduledDeleteAt = null } = {}) {
    return await prisma.file.update({
      where: { id },
      data: {
        deleted: true,
        deletedAt: new Date(),
        status: 'DELETED',
        scheduledDeleteAt,
      },
    });
  }

  /**
   * List files with optional filters. storagePath is excluded from results.
   */
  async list({ service, module, ownerId, referenceId, mimeType, status, from, to, page = 1, limit = 20 } = {}) {
    const where = {
      deleted: false,
      ...(service && { service }),
      ...(module && { module }),
      ...(ownerId && { ownerId }),
      ...(referenceId && { referenceId }),
      ...(mimeType && { mimeType: { contains: mimeType, mode: 'insensitive' } }),
      ...(status && { status }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.file.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          service: true,
          module: true,
          ownerId: true,
          referenceId: true,
          originalName: true,
          mimeType: true,
          size: true,
          checksum: true,
          status: true,
          compressed: true,
          compressionType: true,
          thumbnails: true,
          metadata: true,
          retentionDays: true,
          createdAt: true,
          updatedAt: true,
          // storagePath intentionally excluded
        },
      }),
      prisma.file.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Look up the retention policy for a given service name.
   * Returns null if no policy exists (caller falls back to default).
   * @param {string} service
   * @returns {Promise<object|null>}
   */
  async getRetentionPolicy(service) {
    return await prisma.serviceRetentionPolicy.findUnique({
      where: { service },
    });
  }
}
