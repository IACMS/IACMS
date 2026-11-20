import path from 'path';
import config from '../../config/index.js';

/**
 * MimeTypeGuard — guards against dangerous file types and detects MIME from magic bytes.
 */
export class MimeTypeGuard {
  /**
   * Returns true if the filename has a blocked extension.
   * @param {string} filename
   * @returns {boolean}
   */
  static isBlocked(filename) {
    if (!filename) return false;
    const ext = path.extname(filename).toLowerCase();
    return config.upload.blockedExtensions.some((blocked) => blocked.toLowerCase() === ext);
  }

  static isVideo(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('video/');
  }

  static isImage(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('image/');
  }

  static isAudio(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('audio/');
  }

  static isPdf(mimeType) {
    return mimeType === 'application/pdf';
  }

  /**
   * Normalize and clean a MIME type string.
   * @param {string} mimeType
   * @returns {string}
   */
  static normalize(mimeType) {
    if (!mimeType) return 'application/octet-stream';
    const clean = mimeType.toLowerCase().split(';')[0].trim();
    return clean || 'application/octet-stream';
  }

  /**
   * Detect MIME from magic bytes (file-type). Falls back to client-provided MIME.
   * Magic bytes take precedence over the client Content-Type / filename.
   *
   * @param {Buffer} buffer - at least the first ~4100 bytes
   * @param {string} [fallbackMime]
   * @returns {Promise<string>}
   */
  static async detectFromBuffer(buffer, fallbackMime = 'application/octet-stream') {
    try {
      const { fileTypeFromBuffer } = await import('file-type');
      const detected = await fileTypeFromBuffer(buffer);
      if (detected?.mime) {
        return MimeTypeGuard.normalize(detected.mime);
      }
    } catch {
      /* file-type unavailable or detection failed */
    }
    return MimeTypeGuard.normalize(fallbackMime);
  }
}
