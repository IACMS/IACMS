import { getMinioClient } from '../../../config/minio.js';
import config from '../../../config/index.js';

/**
 * MinIO storage adapter.
 * Implements the IStorageProvider interface.
 * Primary storage for both local dev (MinIO container) and production server.
 *
 * IMPORTANT: storagePath values are internal. Never expose them to clients.
 */
export class MinIOStorage {
  constructor() {
    this.client = getMinioClient();
    this.bucket = config.storage.minio.bucket;
  }

  /**
   * Upload a readable stream to MinIO.
   * @param {string} objectPath
   * @param {import('stream').Readable} stream
   * @param {string} mimeType
   * @param {number} [size] - optional; pass undefined if size is not known ahead of time
   */
  async upload(objectPath, stream, mimeType, size) {
    const metaData = { 'Content-Type': mimeType };
    if (size !== undefined) {
      await this.client.putObject(this.bucket, objectPath, stream, size, metaData);
    } else {
      await this.client.putObject(this.bucket, objectPath, stream, metaData);
    }
  }

  /**
   * Download a file as a readable stream.
   * @param {string} objectPath
   * @returns {Promise<import('stream').Readable>}
   */
  async download(objectPath) {
    return await this.client.getObject(this.bucket, objectPath);
  }

  /**
   * Stream file bytes with optional byte-range support (HTTP 206 / video seek).
   * @param {string} objectPath
   * @param {{ start: number, end: number }} [range]
   * @returns {Promise<import('stream').Readable>}
   */
  async stream(objectPath, range) {
    if (range) {
      const length = range.end - range.start + 1;
      return await this.client.getPartialObject(this.bucket, objectPath, range.start, length);
    }
    return await this.client.getObject(this.bucket, objectPath);
  }

  /**
   * Delete a file from MinIO.
   * @param {string} objectPath
   */
  async delete(objectPath) {
    await this.client.removeObject(this.bucket, objectPath);
  }

  /**
   * Check if a file exists in MinIO.
   * @param {string} objectPath
   * @returns {Promise<boolean>}
   */
  async exists(objectPath) {
    try {
      await this.client.statObject(this.bucket, objectPath);
      return true;
    } catch (err) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey' || err.message?.includes('Not Found')) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Copy a file within the same bucket.
   * @param {string} sourcePath
   * @param {string} destPath
   */
  async copy(sourcePath, destPath) {
    const srcObj = `/${this.bucket}/${sourcePath}`;
    await this.client.copyObject(this.bucket, destPath, srcObj);
  }

  /**
   * Get file stat (size, etag, lastModified).
   * @param {string} objectPath
   */
  async stat(objectPath) {
    return await this.client.statObject(this.bucket, objectPath);
  }

  /**
   * Generate a presigned URL for temporary internal access.
   * NOTE: This URL points to MinIO directly. FMS must proxy the bytes to clients.
   * Never return this URL in API responses.
   * @param {string} objectPath
   * @param {number} expiresInSeconds
   * @returns {Promise<string>}
   */
  async signedUrl(objectPath, expiresInSeconds = 600) {
    return await this.client.presignedGetObject(this.bucket, objectPath, expiresInSeconds);
  }
}
