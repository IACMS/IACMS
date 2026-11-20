import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/database.js';

/**
 * PrismaChunkRepository — all database access for chunked upload sessions and individual chunks.
 */
export class PrismaChunkRepository {
  /**
   * Create a new chunked upload session.
   * @param {object} data
   * @returns {Promise<object>}
   */
  async createUpload(data) {
    return await prisma.chunkUpload.create({ data });
  }

  /**
   * Find a chunked upload session by ID.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findUploadById(id) {
    return await prisma.chunkUpload.findUnique({ where: { id } });
  }

  /**
   * Update the status of a chunked upload session.
   * @param {string} id
   * @param {'IN_PROGRESS'|'MERGING'|'COMPLETE'|'FAILED'|'EXPIRED'} status
   * @returns {Promise<object>}
   */
  async updateUploadStatus(id, status) {
    return await prisma.chunkUpload.update({ where: { id }, data: { status } });
  }

  /**
   * Atomically increment the receivedChunks counter.
   * @param {string} id
   * @returns {Promise<object>}
   */
  async incrementReceivedChunks(id) {
    return await prisma.chunkUpload.update({
      where: { id },
      data: { receivedChunks: { increment: 1 } },
    });
  }

  /**
   * Create a chunk record (one per uploaded chunk).
   * @param {object} data
   * @returns {Promise<object>}
   */
  async createChunk(data) {
    return await prisma.chunk.create({
      data: { id: uuidv4(), ...data },
    });
  }

  /**
   * Get all chunk records for a given upload, ordered by chunkNumber.
   * @param {string} uploadId
   * @returns {Promise<object[]>}
   */
  async findChunks(uploadId) {
    return await prisma.chunk.findMany({
      where: { uploadId },
      orderBy: { chunkNumber: 'asc' },
    });
  }

  /**
   * Find uploads that are still IN_PROGRESS but have passed their expiresAt.
   * Used by ExpiredChunkWorker to clean up abandoned sessions.
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async findExpiredUploads(limit = 50) {
    return await prisma.chunkUpload.findMany({
      where: {
        status: 'IN_PROGRESS',
        expiresAt: { lt: new Date() },
      },
      take: limit,
      orderBy: { expiresAt: 'asc' },
    });
  }

  /**
   * Mark an upload session as EXPIRED.
   * @param {string} id
   * @returns {Promise<object>}
   */
  async markExpired(id) {
    return await prisma.chunkUpload.update({
      where: { id },
      data: { status: 'EXPIRED' },
    });
  }

  /**
   * Delete all chunk records for an upload (used after merge or expiry).
   * @param {string} uploadId
   * @returns {Promise<object>}
   */
  async deleteChunks(uploadId) {
    return await prisma.chunk.deleteMany({ where: { uploadId } });
  }
}
