import { Router } from 'express';
import {
  upload,
  uploadBatch,
  getFile,
  listFiles,
  deleteFile,
  downloadFile,
  viewFile,
  streamFile,
  getSignedUrl,
} from '../controllers/FileController.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { requireScope } from '../middleware/scope.middleware.js';

const router = Router();

// All file routes require authentication
router.use(authenticateToken);

// ── Upload ────────────────────────────────────────────────────────────────────
router.post('/',       requireScope('file.upload'), upload);
// NOTE: /batch must be declared BEFORE /:id to avoid Express matching 'batch' as an :id param
router.post('/batch', requireScope('file.upload'), uploadBatch);

// ── List / Search ─────────────────────────────────────────────────────────────
router.get('/', requireScope('file.read'), listFiles);

// ── Per-file metadata ─────────────────────────────────────────────────────────
router.get('/:id', requireScope('file.read'), getFile);

// ── File delivery ─────────────────────────────────────────────────────────────
router.get('/:id/download',   requireScope('file.read'), downloadFile);
router.get('/:id/view',       requireScope('file.read'), viewFile);
router.get('/:id/stream',     requireScope('file.read'), streamFile);
router.get('/:id/signed-url', requireScope('file.read'), getSignedUrl);

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireScope('file.delete'), deleteFile);

export default router;
