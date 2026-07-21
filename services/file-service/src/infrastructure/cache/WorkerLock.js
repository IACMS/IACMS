import { getRedisClient } from '../../config/redis.config.js';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * Redis distributed lock for worker coordination.
 * Key pattern: fms:lock:worker:{fileId}
 */
export class WorkerLock {
  /**
   * Try to acquire a lock for a file.
   * @param {string} fileId
   * @param {number} [ttlSeconds]
   * @returns {Promise<boolean>} true if lock acquired
   */
  static async acquire(fileId, ttlSeconds = config.workers.lockTtlSeconds) {
    const redis = getRedisClient();
    try {
      if (redis.status !== 'ready') await redis.connect().catch(() => {});
      const key = `fms:lock:worker:${fileId}`;
      const result = await redis.set(key, process.pid.toString(), 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      logger.warn('Failed to acquire worker lock', { fileId, error: err.message });
      return false;
    }
  }

  /**
   * Release a lock for a file.
   * @param {string} fileId
   */
  static async release(fileId) {
    const redis = getRedisClient();
    try {
      if (redis.status !== 'ready') await redis.connect().catch(() => {});
      await redis.del(`fms:lock:worker:${fileId}`);
    } catch (err) {
      logger.warn('Failed to release worker lock', { fileId, error: err.message });
    }
  }
}
