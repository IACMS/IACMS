import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import config from '../../../config/index.js';

/**
 * Local filesystem storage adapter.
 * Used in local development when MinIO is not available (STORAGE_PROVIDER=local).
 *
 * WARNING: Never use in production.
 * - No redundancy
 * - No replication
 * - Data is lost if the container volume is removed
 */
export class LocalStorage {
  constructor() {
    this.basePath = path.resolve(config.storage.local.basePath);
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  _fullPath(objectPath) {
    // Prevent path traversal attacks
    const resolved = path.resolve(this.basePath, objectPath);
    if (!resolved.startsWith(this.basePath)) {
      throw new Error('Path traversal attempt detected');
    }
    return resolved;
  }

  async upload(objectPath, stream, mimeType, size) {
    const fullPath = this._fullPath(objectPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const writeStream = createWriteStream(fullPath);
    await pipeline(stream, writeStream);
  }

  async download(objectPath) {
    const fullPath = this._fullPath(objectPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in local storage: ${objectPath}`);
    }
    return createReadStream(fullPath);
  }

  async stream(objectPath, range) {
    const fullPath = this._fullPath(objectPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in local storage: ${objectPath}`);
    }
    if (range) {
      return createReadStream(fullPath, { start: range.start, end: range.end });
    }
    return createReadStream(fullPath);
  }

  async delete(objectPath) {
    const fullPath = this._fullPath(objectPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async exists(objectPath) {
    const fullPath = this._fullPath(objectPath);
    return fs.existsSync(fullPath);
  }

  async copy(sourcePath, destPath) {
    const src = this._fullPath(sourcePath);
    const dst = this._fullPath(destPath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  async stat(objectPath) {
    const fullPath = this._fullPath(objectPath);
    return fs.statSync(fullPath);
  }

  async signedUrl(objectPath, expiresInSeconds) {
    // Local storage has no signed URL support
    return null;
  }
}
