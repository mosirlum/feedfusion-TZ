import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  getTodayDashboardHandler,
  getProfitAndLossHandler,
  getWelcomeBackHandler,
} from '../controllers/dashboard.controller';

const router = Router();

router.get('/today', authenticate, requireRole('owner'), getTodayDashboardHandler);
router.get('/profit-and-loss', authenticate, requireRole('owner'), getProfitAndLossHandler);
// Any authenticated role — scoped per-role inside the service (CLAUDE.md #99).
router.get('/welcome-back', authenticate, getWelcomeBackHandler);

export default router;
