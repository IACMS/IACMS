import express from 'express';
import { assignRole, revokeRole, getUserRoles, checkPermission } from '../controllers/user-role.controller.js';

const router = express.Router();

router.post('/assign', assignRole);
router.post('/revoke', revokeRole);
router.get('/user/:userId', getUserRoles);
router.post('/check', checkPermission);

export default router;

