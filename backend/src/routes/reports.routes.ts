import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  salesReportHandler,
  productsReportHandler,
  stockReportHandler,
  lowStockReportHandler,
  discountsReportHandler,
  cashReportHandler,
  usersReportHandler,
  purchaseCostsReportHandler,
  salesOverviewHandler,
  narrativeReportHandler,
  salesExcelReportHandler,
} from '../controllers/reports.controller';

const router = Router();

router.get('/sales-overview', authenticate, requireRole('owner'), salesOverviewHandler);
// Narrative Business Report (2026-09-13, CLAUDE.md #64) — streams a PDF,
// every other route here returns JSON. Placed right after sales-overview
// since it's built from the same aggregator.
router.get('/narrative', authenticate, requireRole('owner'), narrativeReportHandler);
// Sales Excel Report (2026-09-14, CLAUDE.md #68e) — streams an .xlsx,
// placed next to /narrative since both stream a file instead of JSON.
router.get('/sales-excel', authenticate, requireRole('owner'), salesExcelReportHandler);
router.get('/sales', authenticate, requireRole('owner'), salesReportHandler);
router.get('/products', authenticate, requireRole('owner'), productsReportHandler);
router.get('/stock', authenticate, requireRole('owner'), stockReportHandler);
router.get('/low-stock', authenticate, requireRole('owner'), lowStockReportHandler);
router.get('/discounts', authenticate, requireRole('owner'), discountsReportHandler);
router.get('/cash', authenticate, requireRole('owner'), cashReportHandler);
router.get('/users', authenticate, requireRole('owner'), usersReportHandler);
router.get('/purchase-costs', authenticate, requireRole('owner'), purchaseCostsReportHandler);

export default router;
