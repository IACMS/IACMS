import express from 'express';
import { assignRole, revokeRole, getUserRoles, checkPermission } from '../controllers/user-role.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/assign', assignRole);
router.post('/revoke', revokeRole);
router.get('/user/:userId', getUserRoles);
router.post('/check', checkPermission);

export default router;

