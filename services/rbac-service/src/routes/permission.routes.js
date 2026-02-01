import express from 'express';
import { 
  getPermissions, 
  getPermission, 
  getUserPermissions, 
  checkPermission 
} from '../controllers/permission.controller.js';

const router = express.Router();

// Get all permissions
router.get('/', getPermissions);

// Get permissions for a specific user (used by API Gateway)
router.get('/user/:userId', getUserPermissions);

// Check if user has a specific permission
router.get('/check/:userId', checkPermission);

// Get permission by ID
router.get('/:id', getPermission);

export default router;

