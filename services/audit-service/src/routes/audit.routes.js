import express from 'express';
import {
  getAuditLogs,
  getAuditLog,
  createAuditLog,
  getAuditLogsByEntity,
} from '../controllers/audit.controller.js';

const router = express.Router();

router.get('/', getAuditLogs);
router.get('/:id', getAuditLog);
router.post('/', createAuditLog);
router.get('/entity/:entityType/:entityId', getAuditLogsByEntity);

export default router;
