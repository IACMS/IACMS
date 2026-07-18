import { Router } from 'express';
import { initUpload, uploadChunk, completeUpload, getUploadStatus } from '../controllers/ChunkController.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireScope } from '../middleware/scope.middleware.js';

const router = Router();

// All chunk routes require authentication
router.use(authenticateToken);

// POST /uploads/init — initialize a new chunked upload session
router.post('/init', requireScope('file.upload'), initUpload);

// PUT /uploads/:uploadId/chunks/:chunkNumber — upload a single chunk (raw bytes)
router.put('/:uploadId/chunks/:chunkNumber', requireScope('file.upload'), uploadChunk);

// POST /uploads/:uploadId/complete — merge all chunks and finalize
router.post('/:uploadId/complete', requireScope('file.upload'), completeUpload);

// GET /uploads/:uploadId/status — check progress / get missing chunk list for resume
router.get('/:uploadId/status', requireScope('file.read'), getUploadStatus);

export default router;
