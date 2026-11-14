import { Router } from 'express';
import { authenticateAdminRequest } from '../middleware/admin-auth.middleware.js';
import { createIamIdentity } from '../controllers/iam-identities.controller.js';

const router = Router();
router.use(authenticateAdminRequest);
router.post('/', createIamIdentity);

export default router;
