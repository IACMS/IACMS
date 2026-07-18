import path from 'path';
import config from '../../config/index.js';

/**
 * MimeTypeGuard — guards against dangerous file types and normalizes MIME strings.
 *
 * Phase 1: extension-based blocking only.
 * Phase 5: magic-byte detection added via file-type library.
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

  /**
   * Returns true if the MIME type is a video type.
   */
  static isVideo(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('video/');
  }

  /**
   * Returns true if the MIME type is an image type.
   */
  static isImage(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('image/');
  }

  /**
   * Returns true if the MIME type is an audio type.
   */
  static isAudio(mimeType) {
    return typeof mimeType === 'string' && mimeType.startsWith('audio/');
  }

  /**
   * Returns true if the file is a PDF.
   */
  static isPdf(mimeType) {
    return mimeType === 'application/pdf';
  }

  /**
   * Normalize and clean a MIME type string.
   * Strips charset and other parameters. Falls back to application/octet-stream.
   * @param {string} mimeType
   * @returns {string}
   */
  static normalize(mimeType) {
    if (!mimeType) return 'application/octet-stream';
    const clean = mimeType.toLowerCase().split(';')[0].trim();
    return clean || 'application/octet-stream';
  }
}
