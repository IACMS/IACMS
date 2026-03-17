import express from 'express';
import { login, refreshToken, logout } from '../controllers/auth/auth.session.controller.js';
import { register, createUser, verifyEmail, resendVerification } from '../controllers/auth/auth.register.controller.js';
import { forgotPassword, resetPassword, changePassword } from '../controllers/auth/auth.password.controller.js';
import { getProfile, updateProfile }   from '../controllers/auth/auth.profile.controller.js';
import {
  listUsers,
  getUser,
  updateUser,
  assignRole,
  deactivateUser,
  reactivateUser,
  deleteUser,
} from '../controllers/auth/admin.users.controller.js';
import { authenticateToken, requirePasswordChange } from '../middleware/auth.middleware.js';

const router = express.Router();

// ── Public routes (no auth) ───────────────────────────────────────────────
router.post('/login',           login);
router.post('/register',        register);
router.post('/refresh',         refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);
router.post('/verify-email',    verifyEmail);

// ── Protected routes (require JWT) ───────────────────────────────────────
// change-password is intentionally excluded from requirePasswordChange so users
// with mustChangePassword=true can still reach it to complete the required change.
router.post('/change-password',        authenticateToken, changePassword);
router.post('/logout',                 authenticateToken, requirePasswordChange, logout);
router.get('/profile',                 authenticateToken, requirePasswordChange, getProfile);
router.patch('/profile',               authenticateToken, requirePasswordChange, updateProfile);
router.post('/resend-verification',    authenticateToken, requirePasswordChange, resendVerification);

// ── Admin: create user ────────────────────────────────────────────────────
router.post('/users/create',    authenticateToken, requirePasswordChange, createUser);

// ── Admin: user management ────────────────────────────────────────────────
router.get('/users',                    authenticateToken, requirePasswordChange, listUsers);
router.get('/users/:id',                authenticateToken, requirePasswordChange, getUser);
router.patch('/users/:id',              authenticateToken, requirePasswordChange, updateUser);
router.patch('/users/:id/role',         authenticateToken, requirePasswordChange, assignRole);
router.patch('/users/:id/deactivate',   authenticateToken, requirePasswordChange, deactivateUser);
router.patch('/users/:id/reactivate',   authenticateToken, requirePasswordChange, reactivateUser);
router.delete('/users/:id',             authenticateToken, requirePasswordChange, deleteUser);

export default router;
