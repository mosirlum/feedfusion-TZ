import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  createStockAdjustmentHandler,
  listStockAdjustmentsHandler,
  getStockAdjustmentsSummaryHandler,
} from '../controllers/stockAdjustments.controller';

const router = Router();

router.post('/', authenticate, requireRole('owner'), createStockAdjustmentHandler);
router.get('/summary', authenticate, requireRole('owner'), getStockAdjustmentsSummaryHandler);
router.get('/', authenticate, requireRole('owner'), listStockAdjustmentsHandler);

export default router;
