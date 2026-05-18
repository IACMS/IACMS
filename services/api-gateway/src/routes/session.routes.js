/**
 * Session Routes for API Gateway
 */

import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.middleware.js';
import {
  sessionLogin,
  sessionLogout,
  sessionStatus,
  sessionRefresh,
} from '../controllers/session.controller.js';

const router = Router();

router.post('/login', sessionLogin);
router.post('/logout', sessionLogout);
router.get('/status', optionalAuth, sessionStatus);
router.post('/refresh', sessionRefresh);

export default router;
