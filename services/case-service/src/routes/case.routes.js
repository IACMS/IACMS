import express from 'express';
import { getCases, getCase, createCase, updateCase, deleteCase } from '../controllers/case.controller.js';

const router = express.Router();

router.get('/', getCases);
router.get('/:id', getCase);
router.post('/', createCase);
router.put('/:id', updateCase);
router.delete('/:id', deleteCase);

export default router;

