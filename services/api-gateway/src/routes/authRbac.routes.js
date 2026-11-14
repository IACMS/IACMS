import express from 'express';
import {
  createRole,
  deleteRole,
  getPermissions,
  getPermission,
  getRole,
  getRoles,
  replaceUserRole,
  updateRole,
} from '../controllers/rbac.controller.js';
import { createProjectUser } from '../controllers/userProvisioning.controller.js';
import { hasAnyPermission } from '../middleware/rbac.middleware.js';

const router = express.Router();

const localRolePath = /^\/(?:roles(?:\/[^/]+)?|permissions(?:\/[^/]+)?|users\/create|users\/[^/]+\/role)\/?$/;

router.use((req, res, next) => {
  if (!localRolePath.test(req.path)) return next();
  if (!req.user?.id) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } });
  if (req.rbacEnvelope?.rbacAvailable !== true) {
    return res.status(503).json({ error: { code: 'POLICY_UNAVAILABLE', message: 'IACMS role authorization is temporarily unavailable' } });
  }
  next();
});

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasAnyPermission(req.rbacEnvelope?.permissions || [], [permission])) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Required permission: ${permission}` } });
    }
    next();
  };
}

router.get('/roles', requirePermission('roles:read'), getRoles);
router.get('/roles/:id', requirePermission('roles:read'), getRole);
router.post('/roles', express.json(), requirePermission('roles:create'), createRole);
router.put('/roles/:id', express.json(), requirePermission('roles:update'), updateRole);
router.patch('/roles/:id', express.json(), requirePermission('roles:update'), updateRole);
router.delete('/roles/:id', requirePermission('roles:delete'), deleteRole);
router.get('/permissions', requirePermission('roles:read'), getPermissions);
router.get('/permissions/:id', requirePermission('roles:read'), getPermission);
router.post('/users/create', express.json({ limit: '32kb' }), requirePermission('users:create'), createProjectUser);
router.patch('/users/:userId/role', express.json(), requirePermission('roles:assign'), replaceUserRole);

export default router;
