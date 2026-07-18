import { getRedisClient } from '../../config/redis.config.js';

const KEY_PREFIX = 'fms:upload';

/**
 * RedisUploadState — tracks which chunks have been received for each chunked upload session.
 *
 * Key design:
 *   fms:upload:{uploadId}:chunks  →  Redis Set of received chunk numbers (as strings)
 *
 * Redis is the source of truth for real-time chunk tracking.
 * The DB receivedChunks counter is incremented for persistence but Redis is used
 * for fast set-membership checks during upload and for computing missing chunks.
 *
 * If Redis loses state (restart/eviction), the ExpiredChunkWorker will eventually
 * clean up stale IN_PROGRESS uploads via DB expiry checks.
 */
export class RedisUploadState {
  _key(uploadId) {
    return `${KEY_PREFIX}:${uploadId}:chunks`;
  }

  /**
   * Mark a chunk number as received.
   * @param {string} uploadId
   * @param {number} chunkNumber
   */
  async addChunk(uploadId, chunkNumber) {
    const redis = getRedisClient();
    await redis.sadd(this._key(uploadId), chunkNumber.toString());
  }

  /**
   * Check if a specific chunk has already been received (idempotency check).
   * @param {string} uploadId
   * @param {number} chunkNumber
   * @returns {Promise<boolean>}
   */
  async hasChunk(uploadId, chunkNumber) {
    const redis = getRedisClient();
    const result = await redis.sismember(this._key(uploadId), chunkNumber.toString());
    return result === 1;
  }

  /**
   * Get all received chunk numbers as a Set<number>.
   * @param {string} uploadId
   * @returns {Promise<Set<number>>}
   */
  async getReceivedChunks(uploadId) {
    const redis = getRedisClient();
    const members = await redis.smembers(this._key(uploadId));
    return new Set(members.map(Number));
  }

  /**
   * Get the count of received chunks.
   * @param {string} uploadId
   * @returns {Promise<number>}
   */
  async getReceivedCount(uploadId) {
    const redis = getRedisClient();
    return await redis.scard(this._key(uploadId));
  }

  /**
   * Compute which chunk numbers are still missing.
   * @param {string} uploadId
   * @param {number} totalChunks
   * @returns {Promise<number[]>}
   */
  async getMissingChunks(uploadId, totalChunks) {
    const received = await this.getReceivedChunks(uploadId);
    const missing = [];
    for (let i = 1; i <= totalChunks; i++) {
      if (!received.has(i)) missing.push(i);
    }
    return missing;
  }

  /**
   * Set a TTL on the chunk tracking key so Redis auto-expires it.
   * Should match the ChunkUpload.expiresAt duration.
   * @param {string} uploadId
   * @param {number} ttlSeconds
   */
  async setExpiry(uploadId, ttlSeconds) {
    const redis = getRedisClient();
    await redis.expire(this._key(uploadId), ttlSeconds);
  }

  /**
   * Delete the chunk tracking state for a completed or expired upload.
   * @param {string} uploadId
   */
  async deleteUploadState(uploadId) {
    const redis = getRedisClient();
    await redis.del(this._key(uploadId));
  }
}
