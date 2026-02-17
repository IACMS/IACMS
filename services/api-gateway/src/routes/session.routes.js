/**
 * Session Routes for API Gateway
 */

import { Router } from 'express';
import {
  sessionLogin,
  sessionLogout,
  sessionStatus,
  sessionRefresh,
} from '../controllers/session.controller.js';

const router = Router();

router.post('/login', sessionLogin);
router.post('/logout', sessionLogout);
router.get('/status', sessionStatus);
router.post('/refresh', sessionRefresh);

export default router;
