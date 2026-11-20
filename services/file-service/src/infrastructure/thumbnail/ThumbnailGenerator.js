import { Readable } from 'stream';
import config from '../../config/index.js';
import { StoragePath } from '../../domain/value-objects/StoragePath.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * ThumbnailGenerator — creates 100/250/500 square thumbnails via Sharp.
 */
export class ThumbnailGenerator {
  /**
   * @param {object} opts
   * @param {Buffer} opts.buffer
   * @param {object} opts.file - File DB record
   * @param {*} opts.storage
   * @returns {Promise<object|null>} thumbnails map or null
   */
  static async generate({ buffer, file, storage }) {
    if (!config.thumbnail.enabled) return null;

    try {
      const sharp = (await import('sharp')).default;
      const thumbnails = {};

      for (const size of config.thumbnail.sizes) {
        const thumbBuffer = await sharp(buffer)
          .resize(size, size, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 80 })
          .toBuffer();

        const thumbPath = StoragePath.buildThumbnail({
          service: file.service,
          module: file.module,
          fileId: file.id,
          size,
        });

        await storage.upload(
          thumbPath,
          Readable.from(thumbBuffer),
          'image/jpeg',
          thumbBuffer.length
        );

        thumbnails[`${size}x${size}`] = thumbPath;
      }

      return thumbnails;
    } catch (err) {
      logger.warn('Thumbnail generation failed', { fileId: file.id, error: err.message });
      return null;
    }
  }
}
