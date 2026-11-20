import { Transform, Readable } from 'stream';
import { createHash } from 'crypto';
import { getRedisClient } from '../../config/redis.config.js';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * Transform that computes SHA-256 while forwarding bytes, and collects the
 * first ~4100 bytes for magic-byte MIME detection.
 */
export class HashAndPeekTransform extends Transform {
  constructor() {
    super();
    this.hash = createHash('sha256');
    this.byteCount = 0;
    this.peekChunks = [];
    this.peekBytes = 0;
    this.peekDone = false;
  }

  _transform(chunk, _encoding, cb) {
    this.hash.update(chunk);
    this.byteCount += chunk.length;

    if (!this.peekDone) {
      this.peekChunks.push(chunk);
      this.peekBytes += chunk.length;
      if (this.peekBytes >= 4100) this.peekDone = true;
    }

    this.push(chunk);
    cb();
  }

  getPeekBuffer() {
    return Buffer.concat(this.peekChunks);
  }

  getChecksum() {
    return `sha256:${this.hash.digest('hex')}`;
  }
}

/**
 * Cache or fetch a signed URL in Redis for the TTL duration.
 * @param {string} fileId
 * @param {number} expiresIn
 * @param {() => Promise<string|null>} generateFn
 */
export async function getCachedSignedUrl(fileId, expiresIn, generateFn) {
  if (!config.signedUrl.cacheEnabled) {
    return await generateFn();
  }

  const redis = getRedisClient();
  const key = `fms:signed:${fileId}:${expiresIn}`;

  try {
    if (redis.status !== 'ready') await redis.connect().catch(() => {});
    const cached = await redis.get(key);
    if (cached) return cached;

    const url = await generateFn();
    if (url) {
      const ttl = Math.max(1, expiresIn - 30);
      await redis.set(key, url, 'EX', ttl);
    }
    return url;
  } catch (err) {
    logger.warn('Signed URL cache unavailable', { error: err.message });
    return await generateFn();
  }
}

export { Readable };
