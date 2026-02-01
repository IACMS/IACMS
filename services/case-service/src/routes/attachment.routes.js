import express from 'express';
import { getAttachments, uploadAttachment, deleteAttachment } from '../controllers/attachment.controller.js';

const router = express.Router();

router.get('/case/:caseId', getAttachments);
router.post('/', uploadAttachment);
router.delete('/:id', deleteAttachment);

export default router;

