import express from 'express';
import { getTenant, validateTenant } from '../controllers/tenant.controller.js';

const router = express.Router();

router.get('/:id', getTenant);
router.get('/validate/:code', validateTenant);

export default router;

