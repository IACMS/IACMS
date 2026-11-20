import express from 'express';
import { login, refreshToken, logout } from '../controllers/auth/auth.session.controller.js';
import { register, createUser, verifyEmail, resendVerification } from '../controllers/auth/auth.register.controller.js';
import { forgotPassword, resetPassword, changePassword, getPasswordStatus } from '../controllers/auth/auth.password.controller.js';
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
import { getRoles, getRole, createRole, updateRole, deleteRole } from '../controllers/role.controller.js';
import { getPermissions, getPermission } from '../controllers/permission.controller.js';
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
// change-password and resend-verification are excluded from requirePasswordChange so
// new accounts can verify email and set a new password before other protected routes.
router.post('/change-password',        authenticateToken, changePassword);
router.get('/password-status',         authenticateToken, getPasswordStatus);
router.post('/resend-verification',    authenticateToken, resendVerification);
router.post('/logout',                 authenticateToken, logout);
router.get('/profile',                 authenticateToken, requirePasswordChange, getProfile);
router.patch('/profile',               authenticateToken, requirePasswordChange, updateProfile);

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

// ── Roles (accessible via /api/v1/auth/roles) ────────────────────────────
router.get('/roles',            authenticateToken, requirePasswordChange, getRoles);
router.get('/roles/:id',        authenticateToken, requirePasswordChange, getRole);
router.post('/roles',           authenticateToken, requirePasswordChange, createRole);
router.put('/roles/:id',        authenticateToken, requirePasswordChange, updateRole);
router.delete('/roles/:id',     authenticateToken, requirePasswordChange, deleteRole);

// ── Permissions (accessible via /api/v1/auth/permissions) ────────────────
router.get('/permissions',      authenticateToken, requirePasswordChange, getPermissions);
router.get('/permissions/:id',  authenticateToken, requirePasswordChange, getPermission);

export default router;
