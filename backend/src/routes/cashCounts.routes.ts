import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  recordCashCountHandler,
  listCashCountsHandler,
  getCashControlSummaryHandler,
} from '../controllers/cashCounts.controller';

const router = Router();

router.post('/', authenticate, requireRole('owner'), recordCashCountHandler);
router.get('/summary', authenticate, requireRole('owner'), getCashControlSummaryHandler);
router.get('/', authenticate, requireRole('owner'), listCashCountsHandler);

export default router;
