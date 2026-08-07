import express from 'express';
import { getAssignments, assignCase, unassignCase } from '../controllers/assignment.controller.js';

const router = express.Router();

router.get('/', getAssignments);
router.post('/', assignCase);
router.post('/:id/unassign', unassignCase);

export default router;

