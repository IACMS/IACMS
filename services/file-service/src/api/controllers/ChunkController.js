import { z } from 'zod';
import { ChunkService } from '../../application/services/ChunkService.js';
import { ValidationError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');
const chunkService = new ChunkService();

// ── Validation schemas ────────────────────────────────────────────────────────

const initSchema = z.object({
  service: z
    .string({ required_error: 'service is required' })
    .min(1).max(100)
    .regex(/^[a-z0-9-]+$/, 'service must be lowercase alphanumeric with hyphens'),
  module: z
    .string({ required_error: 'module is required' })
    .min(1).max(100)
    .regex(/^[a-z0-9-]+$/, 'module must be lowercase alphanumeric with hyphens'),
  referenceId:  z.string().max(200).optional(),
  originalName: z.string({ required_error: 'originalName is required' }).min(1).max(500),
  mimeType:     z.string({ required_error: 'mimeType is required' }).min(1).max(200),
  totalSize:    z.number({ required_error: 'totalSize is required' }).int().positive(),
  totalChunks:  z.number({ required_error: 'totalChunks is required' }).int().positive().max(10000),
  chunkSize:    z.number({ required_error: 'chunkSize is required' }).int().positive(),
});

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /uploads/init
 * Initialize a new chunked upload session.
 *
 * Body (JSON):
 *   service, module, originalName, mimeType, totalSize, totalChunks, chunkSize
 *   referenceId (optional)
 *
 * Response 201:
 *   { uploadId, expiresAt, totalChunks, chunkSize }
 */
export async function initUpload(req, res, next) {
  try {
    const result = initSchema.safeParse(req.body);
    if (!result.success) {
      const msgs = result.error.errors
        .map((e) => `${e.path.join('.') || 'field'}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`Init upload validation failed — ${msgs}`);
    }

    const upload = await chunkService.initUpload({
      ...result.data,
      ownerId: req.user.id,
    });

    logger.info('Upload session created', {
      uploadId: upload.id,
      userId: req.user.id,
      service: result.data.service,
      originalName: result.data.originalName,
    });

    res.status(201).json({
      uploadId:    upload.id,
      expiresAt:   upload.expiresAt,
      totalChunks: upload.totalChunks,
      chunkSize:   upload.chunkSize,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /uploads/:uploadId/chunks/:chunkNumber
 * Upload a single chunk.
 *
 * Headers:
 *   Content-Type: application/octet-stream
 *   X-Chunk-Checksum: sha256:... (optional)
 *
 * Body: raw chunk bytes
 *
 * Response 200:
 *   { uploadId, chunkNumber, received, total }
 */
export async function uploadChunk(req, res, next) {
  try {
    const { uploadId } = req.params;
    const chunkNumber  = parseInt(req.params.chunkNumber, 10);

    if (isNaN(chunkNumber) || chunkNumber < 1) {
      throw new ValidationError('chunkNumber must be a positive integer starting from 1');
    }

    // Optional per-chunk checksum for integrity verification (Phase 5 will enforce this)
    const chunkChecksum = req.headers['x-chunk-checksum'] || null;

    const progress = await chunkService.uploadChunk({
      uploadId,
      chunkNumber,
      stream: req,   // raw octet-stream request body
      chunkChecksum,
    });

    res.json({
      uploadId,
      chunkNumber,
      received: progress.receivedChunks,
      total:    progress.totalChunks,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /uploads/:uploadId/complete
 * Merge all received chunks and create the final File record.
 *
 * All chunks must be received before calling this endpoint.
 * If any chunks are missing, returns 400 with a list of missing chunk numbers.
 *
 * Response 200:
 *   { fileId, status, checksum, size }
 */
export async function completeUpload(req, res, next) {
  try {
    const { uploadId } = req.params;
    const result = await chunkService.completeUpload(uploadId);

    res.json({
      fileId:   result.fileId,
      status:   result.status,
      checksum: result.checksum,
      size:     result.size,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /uploads/:uploadId/status
 * Return upload progress and the list of missing chunk numbers.
 * Used by clients to resume an interrupted upload.
 *
 * Response 200:
 *   { uploadId, status, totalChunks, receivedChunks, missingChunks, expiresAt, isExpired, ... }
 */
export async function getUploadStatus(req, res, next) {
  try {
    const { uploadId } = req.params;
    const status = await chunkService.getStatus(uploadId);
    res.json(status);
  } catch (err) {
    next(err);
  }
}
