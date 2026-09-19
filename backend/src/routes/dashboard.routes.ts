import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { getTodayDashboardHandler, getProfitAndLossHandler } from '../controllers/dashboard.controller';

const router = Router();

router.get('/today', authenticate, requireRole('owner'), getTodayDashboardHandler);
router.get('/profit-and-loss', authenticate, requireRole('owner'), getProfitAndLossHandler);

export default router;
