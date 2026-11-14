import { Router } from 'express';
import { authenticateAdminRequest } from '../middleware/admin-auth.middleware.js';
import {
  addIamOrganizationMember,
  createIamOrganization,
  listIamOrganizationMembers,
  listIamOrganizations,
  updateIamOrganization,
  updateIamOrganizationMember,
} from '../controllers/iam-organizations.controller.js';

const router = Router();
router.use(authenticateAdminRequest);
router.get('/', listIamOrganizations);
router.post('/', createIamOrganization);
router.patch('/:organizationId', updateIamOrganization);
router.get('/:organizationId/memberships', listIamOrganizationMembers);
router.post('/:organizationId/memberships', addIamOrganizationMember);
router.patch('/:organizationId/memberships/:subjectId', updateIamOrganizationMember);

export default router;
