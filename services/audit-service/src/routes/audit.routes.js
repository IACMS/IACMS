import express from 'express';
import {
  getAuditLogs,
  getAuditLog,
  createAuditLog,
  getAuditLogsByEntity,
  getCaseAuditTrail,
  getUserAuditActions,
  exportComplianceCsv,
} from '../controllers/audit.controller.js';

const router = express.Router();

router.get('/', getAuditLogs);

router.get('/cases/:caseId', getCaseAuditTrail);
router.get('/users/:userId/actions', getUserAuditActions);
router.get('/compliance/:tenantId', exportComplianceCsv);

router.post('/', createAuditLog);
router.get('/entity/:entityType/:entityId', getAuditLogsByEntity);
router.get('/:id', getAuditLog);

export default router;
