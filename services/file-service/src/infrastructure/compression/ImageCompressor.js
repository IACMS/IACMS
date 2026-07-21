import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * ImageCompressor — compresses images with Sharp (async worker path only).
 */
export class ImageCompressor {
  /**
   * @param {Buffer} input
   * @returns {Promise<{ buffer: Buffer, mimeType: string, compressionType: string }|null>}
   */
  static async compress(input) {
    if (!config.compression.image.enabled) return null;

    try {
      const sharp = (await import('sharp')).default;
      const format = config.compression.image.format || 'webp';
      const quality = config.compression.image.quality || 80;

      let pipeline = sharp(input);
      let mimeType;
      let compressionType;

      if (format === 'jpeg' || format === 'jpg') {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        mimeType = 'image/jpeg';
        compressionType = 'jpeg';
      } else {
        pipeline = pipeline.webp({ quality });
        mimeType = 'image/webp';
        compressionType = 'webp';
      }

      const buffer = await pipeline.toBuffer();
      return { buffer, mimeType, compressionType };
    } catch (err) {
      logger.warn('Image compression failed', { error: err.message });
      return null;
    }
  }
}
