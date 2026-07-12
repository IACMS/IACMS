import express from 'express';
import {
  listTenants,
  getTenant,
  listTenantDepartments,
  validateTenant,
  updateTenantConfig,
  registerTenant,
  uploadTenantLogo,
} from '../controllers/tenant.controller.js';
import { authenticateTokenOptional } from '../middleware/auth.middleware.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

router.post('/register', authenticateTokenOptional, registerTenant);
router.get('/', listTenants);
router.get('/validate/:code', validateTenant);
router.get('/:id/departments', listTenantDepartments);
router.get('/:id', getTenant);
router.patch('/:id/config', updateTenantConfig);

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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error('Invalid file type. Only PNG, JPEG, WebP, or SVG images are allowed.'));
    }
    cb(null, true);
  },
});

router.post('/:id/logo', upload.single('file'), uploadTenantLogo);

export default router;

