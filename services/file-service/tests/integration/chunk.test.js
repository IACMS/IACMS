/**
 * Integration tests for chunked upload.
 *
 * These tests exercise the ChunkService logic end-to-end using:
 *   - LocalStorage (no MinIO required)
 *   - An in-memory mock for Redis (RedisUploadState)
 *   - A real Prisma client pointing to the test database
 *
 * Prerequisites:
 *   - DATABASE_URL set to a test database
 *   - `npx prisma migrate deploy` run against that database
 *   - STORAGE_PROVIDER=local in env
 *
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Mock Redis before imports ─────────────────────────────────────────────────
// Redis is mocked so integration tests don't require a running Redis instance.

const chunkSets = {};

vi.mock('../../src/infrastructure/cache/RedisUploadState.js', () => ({
  RedisUploadState: class {
    _key(id) { return id; }
    async addChunk(uploadId, n) {
      chunkSets[uploadId] = chunkSets[uploadId] || new Set();
      chunkSets[uploadId].add(n);
    }
    async hasChunk(uploadId, n) {
      return chunkSets[uploadId]?.has(n) ?? false;
    }
    async getReceivedChunks(uploadId) {
      return chunkSets[uploadId] ?? new Set();
    }
    async getReceivedCount(uploadId) {
      return chunkSets[uploadId]?.size ?? 0;
    }
    async getMissingChunks(uploadId, total) {
      const received = chunkSets[uploadId] ?? new Set();
      const missing = [];
      for (let i = 1; i <= total; i++) if (!received.has(i)) missing.push(i);
      return missing;
    }
    async setExpiry() {}
    async deleteUploadState(uploadId) { delete chunkSets[uploadId]; }
  },
}));

// ── Set env before config is loaded ──────────────────────────────────────────
process.env.STORAGE_PROVIDER = 'local';
process.env.LOCAL_STORAGE_PATH = './test-uploads';
process.env.CHUNK_TTL_HOURS = '1';
process.env.DEFAULT_SOFT_DELETE_DAYS = '30';

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { ChunkService } from '../../src/application/services/ChunkService.js';
import { StorageFactory } from '../../src/infrastructure/storage/StorageFactory.js';
import prisma from '../../src/config/database.js';

const chunkService = new ChunkService();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a Readable stream from a Buffer */
function bufferToStream(buf) {
  return Readable.from((async function* () { yield buf; })());
}

/** Generate test chunk buffers — each is `size` bytes of repeated `char` */
function makeChunks(count, size = 1024, char = 0x61) {
  return Array.from({ length: count }, () => Buffer.alloc(size, char));
}

const TEST_USER = 'test-user-integration';
const TEST_SERVICE = 'test';
const TEST_MODULE  = 'integration';

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(() => {
  fs.mkdirSync('./test-uploads', { recursive: true });
  StorageFactory.reset();
});

afterAll(async () => {
  // Remove test upload files
  fs.rmSync('./test-uploads', { recursive: true, force: true });
  // Clean up test DB records
  await prisma.chunk.deleteMany({ where: { upload: { ownerId: TEST_USER } } });
  await prisma.chunkUpload.deleteMany({ where: { ownerId: TEST_USER } });
  await prisma.file.deleteMany({ where: { ownerId: TEST_USER } });
  await prisma.$disconnect();
});

beforeEach(() => {
  // Clear Redis mock state between tests
  for (const key of Object.keys(chunkSets)) delete chunkSets[key];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChunkService — init', () => {
  it('creates a ChunkUpload record and returns an uploadId', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE,
      module: TEST_MODULE,
      ownerId: TEST_USER,
      originalName: 'video.mp4',
      mimeType: 'video/mp4',
      totalSize: 3 * 1024,
      totalChunks: 3,
      chunkSize: 1024,
    });

    expect(upload.id).toBeTruthy();
    expect(upload.status).toBe('IN_PROGRESS');
    expect(upload.totalChunks).toBe(3);
    expect(upload.expiresAt).toBeInstanceOf(Date);
    expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('ChunkService — uploadChunk', () => {
  it('accepts chunks 1 through N and tracks progress', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'doc.pdf', mimeType: 'application/pdf',
      totalSize: 3072, totalChunks: 3, chunkSize: 1024,
    });

    const chunks = makeChunks(3);

    for (let i = 1; i <= 3; i++) {
      const progress = await chunkService.uploadChunk({
        uploadId: upload.id,
        chunkNumber: i,
        stream: bufferToStream(chunks[i - 1]),
        chunkChecksum: null,
      });
      expect(progress.receivedChunks).toBe(i);
      expect(progress.totalChunks).toBe(3);
    }
  });

  it('is idempotent — re-sending chunk 2 does not double-count', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'img.jpg', mimeType: 'image/jpeg',
      totalSize: 2048, totalChunks: 2, chunkSize: 1024,
    });

    const chunk = makeChunks(1)[0];

    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 1, stream: bufferToStream(chunk) });
    const progress = await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 1, stream: bufferToStream(chunk) });

    expect(progress.receivedChunks).toBe(1); // still 1, not 2
  });

  it('rejects chunkNumber 0', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'x.bin', mimeType: 'application/octet-stream',
      totalSize: 1024, totalChunks: 1, chunkSize: 1024,
    });

    await expect(
      chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 0, stream: bufferToStream(Buffer.alloc(100)) })
    ).rejects.toThrow('out of range');
  });

  it('rejects chunkNumber greater than totalChunks', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'x.bin', mimeType: 'application/octet-stream',
      totalSize: 1024, totalChunks: 2, chunkSize: 512,
    });

    await expect(
      chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 99, stream: bufferToStream(Buffer.alloc(100)) })
    ).rejects.toThrow('out of range');
  });

  it('throws NOT_FOUND for a non-existent uploadId', async () => {
    await expect(
      chunkService.uploadChunk({
        uploadId: '00000000-0000-0000-0000-000000000000',
        chunkNumber: 1,
        stream: bufferToStream(Buffer.alloc(100)),
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ChunkService — getStatus (resume support)', () => {
  it('reports missing chunks when some are skipped', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'big.mp4', mimeType: 'video/mp4',
      totalSize: 5 * 1024, totalChunks: 5, chunkSize: 1024,
    });

    const chunk = makeChunks(1)[0];

    // Upload chunks 1, 2, 4 — skip 3 and 5
    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 1, stream: bufferToStream(chunk) });
    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 2, stream: bufferToStream(chunk) });
    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 4, stream: bufferToStream(chunk) });

    const status = await chunkService.getStatus(upload.id);

    expect(status.receivedChunks).toBe(3);
    expect(status.missingChunks).toEqual(expect.arrayContaining([3, 5]));
    expect(status.missingChunks).not.toContain(1);
    expect(status.missingChunks).not.toContain(2);
    expect(status.missingChunks).not.toContain(4);
  });

  it('reports 0 missing chunks when all are received', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'complete.bin', mimeType: 'application/octet-stream',
      totalSize: 2048, totalChunks: 2, chunkSize: 1024,
    });

    const chunk = makeChunks(1)[0];
    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 1, stream: bufferToStream(chunk) });
    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 2, stream: bufferToStream(chunk) });

    const status = await chunkService.getStatus(upload.id);
    expect(status.missingChunks).toHaveLength(0);
    expect(status.receivedChunks).toBe(2);
  });
});

describe('ChunkService — completeUpload', () => {
  it('merges chunks, creates a File record, and returns the fileId', async () => {
    const chunks = makeChunks(4, 512); // 4 × 512 bytes = 2048 bytes total

    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'merged.txt', mimeType: 'text/plain',
      totalSize: 4 * 512, totalChunks: 4, chunkSize: 512,
    });

    for (let i = 1; i <= 4; i++) {
      await chunkService.uploadChunk({
        uploadId: upload.id,
        chunkNumber: i,
        stream: bufferToStream(chunks[i - 1]),
      });
    }

    const result = await chunkService.completeUpload(upload.id);

    expect(result.fileId).toBeTruthy();
    expect(result.status).toBe('AVAILABLE');
    expect(result.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.size).toBe(4 * 512);

    // Verify the File record exists in DB
    const file = await prisma.file.findUnique({ where: { id: result.fileId } });
    expect(file).toBeTruthy();
    expect(file.originalName).toBe('merged.txt');
    expect(file.status).toBe('AVAILABLE');
    expect(Number(file.size)).toBe(4 * 512);
  });

  it('rejects complete when chunks are missing', async () => {
    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'incomplete.bin', mimeType: 'application/octet-stream',
      totalSize: 3 * 1024, totalChunks: 3, chunkSize: 1024,
    });

    const chunk = makeChunks(1)[0];
    // Only upload 2 of 3 chunks
    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 1, stream: bufferToStream(chunk) });
    await chunkService.uploadChunk({ uploadId: upload.id, chunkNumber: 2, stream: bufferToStream(chunk) });

    await expect(chunkService.completeUpload(upload.id)).rejects.toThrow(/Missing/);
  });

  it('merged file checksum matches manual SHA-256 of concatenated chunks', async () => {
    const { createHash } = await import('crypto');

    const chunkData = [
      Buffer.from('Hello, '),
      Buffer.from('world'),
      Buffer.from('!'),
    ];
    const expectedHash = createHash('sha256')
      .update(Buffer.concat(chunkData))
      .digest('hex');

    const upload = await chunkService.initUpload({
      service: TEST_SERVICE, module: TEST_MODULE, ownerId: TEST_USER,
      originalName: 'hash-verify.txt', mimeType: 'text/plain',
      totalSize: chunkData.reduce((s, b) => s + b.length, 0),
      totalChunks: 3,
      chunkSize: 7,
    });

    for (let i = 1; i <= 3; i++) {
      await chunkService.uploadChunk({
        uploadId: upload.id,
        chunkNumber: i,
        stream: bufferToStream(chunkData[i - 1]),
      });
    }

    const result = await chunkService.completeUpload(upload.id);
    expect(result.checksum).toBe(`sha256:${expectedHash}`);
  });
});
