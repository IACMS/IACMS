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
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// ── Public routes (no auth) ───────────────────────────────────────────────
router.post('/login', login);
router.post('/register', register);
router.post('/refresh', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// ── Protected routes (require JWT) ───────────────────────────────────────
router.post('/logout', authenticateToken, logout);
router.get('/profile', authenticateToken, getProfile);
router.post('/change-password', authenticateToken, changePassword);

// ── Admin routes (require JWT — RBAC enforcement is done at API Gateway) ──
router.post('/users/create', authenticateToken, createUser);

export default router;
