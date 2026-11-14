import express from 'express';
import {
  addRolePermission,
  assignUserRole,
  checkUserPermission,
  createRole,
  deleteRole,
  getPermissions,
  getPermission,
  getRole,
  getRoles,
  getUserRoles,
  removeRolePermission,
  revokeUserRole,
  updateRole,
} from '../controllers/rbac.controller.js';
import { hasAnyPermission } from '../middleware/rbac.middleware.js';

const router = express.Router();

function requireResolvedRbac(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } });
  if (req.rbacEnvelope?.rbacAvailable !== true) {
    return res.status(503).json({ error: { code: 'POLICY_UNAVAILABLE', message: 'IACMS role authorization is temporarily unavailable' } });
  }
  next();
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!hasAnyPermission(req.rbacEnvelope?.permissions || [], permissions)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Required permission: ${permissions.join(' or ')}` } });
    }
    next();
  };
}

router.use(requireResolvedRbac);

router.get('/roles', requirePermission('roles:read', 'users:read', 'workflows:read'), getRoles);
router.get('/roles/:id', requirePermission('roles:read'), getRole);
router.post('/roles', requirePermission('roles:create'), createRole);
router.put('/roles/:id', requirePermission('roles:update'), updateRole);
router.patch('/roles/:id', requirePermission('roles:update'), updateRole);
router.delete('/roles/:id', requirePermission('roles:delete'), deleteRole);

router.get('/permissions', requirePermission('roles:read', 'roles:create', 'roles:update'), getPermissions);
router.get('/permissions/:id', requirePermission('roles:read'), getPermission);
router.get('/user-roles/user/:userId', requirePermission('roles:read', 'users:read'), getUserRoles);
router.post('/user-roles/assign', requirePermission('roles:assign'), assignUserRole);
router.post('/user-roles/revoke', requirePermission('roles:assign'), revokeUserRole);
router.post('/user-roles/check', requirePermission('roles:read'), checkUserPermission);

router.post('/role-permissions', requirePermission('roles:update'), addRolePermission);
router.delete('/role-permissions/:roleId/:permissionId', requirePermission('roles:update'), removeRolePermission);

export default router;
