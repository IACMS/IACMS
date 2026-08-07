import express from 'express';
import { getDashboardTasks, getDashboardReports } from '../controllers/dashboard.controller.js';

const router = express.Router();

router.get('/tasks', getDashboardTasks);
router.get('/reports', getDashboardReports);

export default router;
