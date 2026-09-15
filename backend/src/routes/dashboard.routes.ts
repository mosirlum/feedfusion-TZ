import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { getTodayDashboardHandler } from '../controllers/dashboard.controller';

const router = Router();

router.get('/today', authenticate, requireRole('owner'), getTodayDashboardHandler);

export default router;
