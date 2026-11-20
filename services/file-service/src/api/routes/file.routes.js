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
import { uploadRateLimit } from '../middleware/rateLimit.middleware.js';

const router = Router();

router.use(authenticateToken);

router.post('/', requireScope('file.upload'), uploadRateLimit, upload);
router.post('/batch', requireScope('file.upload'), uploadRateLimit, uploadBatch);

router.get('/', requireScope('file.read'), listFiles);
router.get('/:id', requireScope('file.read'), getFile);

router.get('/:id/download', requireScope('file.read'), downloadFile);
router.get('/:id/view', requireScope('file.read'), viewFile);
router.get('/:id/stream', requireScope('file.read'), streamFile);
router.get('/:id/signed-url', requireScope('file.read'), getSignedUrl);

router.delete('/:id', requireScope('file.delete'), deleteFile);

export default router;
