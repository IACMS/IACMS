import express from 'express';
import {
  login,
  register,
  refreshToken,
  logout,
  getProfile,
  createUser,
  forgotPassword,
  resetPassword,
  changePassword,
} from '../controllers/auth.controller.js';
import { authenticateToken, requirePasswordChange } from '../middleware/auth.middleware.js';

const router = express.Router();

// ── Public routes (no auth) ───────────────────────────────────────────────
router.post('/login', login);
router.post('/register', register);
router.post('/refresh', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// ── Protected routes (require JWT) ───────────────────────────────────────
// change-password is intentionally excluded from requirePasswordChange so users
// with mustChangePassword=true can still reach it to complete the required change.
router.post('/change-password', authenticateToken, changePassword);
router.post('/logout',       authenticateToken, requirePasswordChange, logout);
router.get('/profile',       authenticateToken, requirePasswordChange, getProfile);

// ── Admin routes (require JWT — RBAC enforcement is done at API Gateway) ──
router.post('/users/create', authenticateToken, requirePasswordChange, createUser);

export default router;
