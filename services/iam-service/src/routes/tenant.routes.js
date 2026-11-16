import express from 'express';
import {
  listTenants,
  getTenant,
  validateTenant,
  updateTenantConfig,
  registerTenant,
  selfRegisterTenant,
  uploadTenantLogo,
  resolveActorContext,
} from '../controllers/tenant.controller.js';
import { authenticateTokenOptional, authenticateToken } from '../middleware/auth.middleware.js';
import { NotFoundError, ForbiddenError } from '#iam/iamErrors.js';
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const UPLOAD_LIMITS = { fileSize: 5 * 1024 * 1024 }; // 5MB

export const MIME_TO_EXTENSION = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export function validateMagicBytes(buffer, mimetype) {
  if (!buffer || buffer.length < 8) return false;
  if (mimetype === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/webp') {
    if (buffer.length < 12) return false;
    const isRiff =
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46;
    const isWebp =
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50;
    return isRiff && isWebp;
  }
  return false;
}

export async function authorizeTenantLogoUpload(req, res, next) {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Tenant ID must be a valid UUID' });
  }

  try {
    const { actorTenantId, isSystemAdmin, isTenantAdmin } = await resolveActorContext(req);
    if (!isSystemAdmin && id !== actorTenantId) {
      throw new NotFoundError('Tenant');
    }
    if (!(isSystemAdmin || isTenantAdmin)) {
      throw new ForbiddenError('Only tenant administrators or system administrators may upload a tenant logo');
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function tenantLogoFileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Invalid file type. Only PNG, JPEG, or WebP images are allowed.'));
  }
  cb(null, true);
}

const uploadRoot = path.join(process.cwd(), 'uploads');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: UPLOAD_LIMITS,
  fileFilter: tenantLogoFileFilter,
});

export function handleTenantLogoStorage(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Logo file is required' });
  }

  if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({ error: 'INVALID_FILE_CONTENT', message: 'File magic bytes do not match declared MIME type' });
  }

  // Derive file extension from allowlist keyed by validated mimetype; ignore originalname
  const ext = MIME_TO_EXTENSION[req.file.mimetype] || '.png';
  const filename = `logo${ext}`;
  const tenantId = req.params.id;
  const dir = path.join(uploadRoot, 'tenants', tenantId);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), req.file.buffer);

  req.file.filename = filename;
  next();
}

router.post(
  '/:id/logo',
  authenticateToken,
  authorizeTenantLogoUpload,
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
  handleTenantLogoStorage,
  uploadTenantLogo
);

export default router;
