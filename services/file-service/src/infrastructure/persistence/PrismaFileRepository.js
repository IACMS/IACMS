import prisma from '../../config/database.js';

/**
 * PrismaFileRepository — all database access for files and retention policies.
 */
export class PrismaFileRepository {
  async create(data) {
    return await prisma.file.create({ data });
  }

  async findById(id) {
    return await prisma.file.findFirst({
      where: { id, deleted: false },
    });
  }

  async findByIdRaw(id) {
    return await prisma.file.findUnique({ where: { id } });
  }

  async findByChecksum(checksum, service) {
    return await prisma.file.findFirst({
      where: {
        checksum,
        service,
        deleted: false,
        status: 'AVAILABLE',
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id, data) {
    return await prisma.file.update({ where: { id }, data });
  }

  /**
   * Atomic status transition: only updates if current status matches expected.
   * @returns {Promise<object|null>} updated row or null if race lost
   */
  async transitionStatus(id, fromStatus, toStatus, extra = {}) {
    const result = await prisma.file.updateMany({
      where: { id, status: fromStatus, deleted: false },
      data: { status: toStatus, ...extra },
    });
    if (result.count === 0) return null;
    return await prisma.file.findUnique({ where: { id } });
  }

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

  async softDeleteByReferenceId(referenceId, { scheduledDeleteAt = null } = {}) {
    return await prisma.file.updateMany({
      where: { referenceId, deleted: false },
      data: {
        deleted: true,
        deletedAt: new Date(),
        status: 'DELETED',
        scheduledDeleteAt,
      },
    });
  }

  async findByStatus(status, { take = 10 } = {}) {
    return await prisma.file.findMany({
      where: { status, deleted: false },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  async findDueForRetry({ take = 10, maxRetries = 3 } = {}) {
    return await prisma.file.findMany({
      where: {
        status: 'FAILED',
        deleted: false,
        retryCount: { lt: maxRetries },
        OR: [{ retryAt: null }, { retryAt: { lte: new Date() } }],
      },
      orderBy: { retryAt: 'asc' },
      take,
    });
  }

  async findDueForPermanentDelete({ take = 50 } = {}) {
    return await prisma.file.findMany({
      where: {
        deleted: true,
        scheduledDeleteAt: { not: null, lte: new Date() },
      },
      orderBy: { scheduledDeleteAt: 'asc' },
      take,
    });
  }

  async hardDelete(id) {
    return await prisma.file.delete({ where: { id } });
  }

  async countByStatuses(statuses) {
    return await prisma.file.count({
      where: { status: { in: statuses }, deleted: false },
    });
  }

  async list({
    service,
    module,
    ownerId,
    referenceId,
    mimeType,
    status,
    from,
    to,
    page = 1,
    limit = 20,
    crossService = false,
  } = {}) {
    const where = {
      deleted: false,
      ...(!crossService && service ? { service } : {}),
      ...(crossService && service ? { service } : {}),
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
          versionOf: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.file.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getRetentionPolicy(service) {
    return await prisma.serviceRetentionPolicy.findUnique({
      where: { service },
    });
  }
}
