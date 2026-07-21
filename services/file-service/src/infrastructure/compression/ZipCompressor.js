import { promisify } from 'util';
import { gzip } from 'zlib';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const gzipAsync = promisify(gzip);
const logger = new Logger('file-service');

/**
 * ZipCompressor — gzip-wraps documents when COMPRESSION_DOCUMENT_ENABLED=true.
 */
export class ZipCompressor {
  /**
   * @param {Buffer} input
   * @returns {Promise<{ buffer: Buffer, mimeType: string, compressionType: string }|null>}
   */
  static async compress(input) {
    if (!config.compression.document.enabled) return null;

    try {
      const buffer = await gzipAsync(input);
      return {
        buffer,
        mimeType: 'application/gzip',
        compressionType: 'zip',
      };
    } catch (err) {
      logger.warn('Document compression failed', { error: err.message });
      return null;
    }
  }
}
