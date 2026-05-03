import express from 'express';
import { getTenant, validateTenant, updateTenantConfig, registerTenant } from '../controllers/tenant.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/register', registerTenant);
router.get('/validate/:code', validateTenant);
router.get('/:id', getTenant);
router.patch('/:id/config', authenticateToken, updateTenantConfig);

export default router;

