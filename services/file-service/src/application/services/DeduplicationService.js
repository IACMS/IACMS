import { PrismaFileRepository } from '../../infrastructure/persistence/PrismaFileRepository.js';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');
const fileRepo = new PrismaFileRepository();

/**
 * DeduplicationService — content-addressable reuse of physical storage.
 * Feature-flagged via DEDUPLICATION_ENABLED.
 */
export class DeduplicationService {
  /**
   * Find an existing non-deleted file with the same checksum within the same service.
   * @param {string} checksum
   * @param {string} service
   * @returns {Promise<object|null>}
   */
  static async findDuplicate(checksum, service) {
    if (!config.deduplication.enabled) return null;

    const existing = await fileRepo.findByChecksum(checksum, service);
    if (existing) {
      logger.info('Deduplication hit', {
        checksum,
        service,
        existingFileId: existing.id,
      });
    }
    return existing;
  }
}
