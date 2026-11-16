import express from 'express';
import {
  listTenants,
  getTenant,
  validateTenant,
  updateTenantConfig,
  registerTenant,
  selfRegisterTenant,
  uploadTenantLogo,
} from '../controllers/tenant.controller.js';
import { authenticateTokenOptional, authenticateToken } from '../middleware/auth.middleware.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

router.post('/register', authenticateTokenOptional, registerTenant);
router.post('/self-register', selfRegisterTenant);
router.get('/validate/:code', validateTenant);

router.get('/', authenticateToken, listTenants);
router.get('/:id', authenticateToken, getTenant);
router.patch('/:id/config', authenticateToken, updateTenantConfig);

export const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const UPLOAD_LIMITS = { fileSize: 5 * 1024 * 1024 }; // 5MB

export function tenantLogoFileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Invalid file type. Only PNG, JPEG, or WebP images are allowed.'));
  }
  cb(null, true);
}

const uploadRoot = path.join(process.cwd(), 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = req.params.id;
      const dir = path.join(uploadRoot, 'tenants', tenantId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, `logo${ext}`);
    },
  }),
  limits: UPLOAD_LIMITS,
  fileFilter: tenantLogoFileFilter,
});

router.post(
  '/:id/logo',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: 'FILE_UPLOAD_ERROR', message: err.message });
      }
      if (err) {
        return res.status(400).json({ error: 'INVALID_FILE_TYPE', message: err.message });
      }
      next();
    });
  },
  uploadTenantLogo
);

export default router;
