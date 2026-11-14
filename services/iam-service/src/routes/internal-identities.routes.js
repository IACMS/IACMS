import express from 'express';
import { listIdentitySnapshotInternal, setIdentityActiveInternal, updateIdentityInternal } from '../controllers/internal-identities.controller.js';
import { requireInternalRequest } from '#iam/iamRequireInternalRequest.js';

const router = express.Router();
router.use(requireInternalRequest());
router.get('/snapshot', listIdentitySnapshotInternal);
router.patch('/:id', updateIdentityInternal);
router.patch('/:id/active', setIdentityActiveInternal);

export default router;
