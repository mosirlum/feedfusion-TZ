import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  recordStockCountHandler,
  approveStockCountHandler,
  rejectStockCountHandler,
  listStockCountsHandler,
  getStockCountSummaryHandler,
  getStockCountRecentActivityHandler,
} from '../controllers/stockCounts.controller';

const router = Router();

// api-reference.md: POST /stock-counts is owner/sales; approve is owner-only.
router.post('/', authenticate, requireRole('sales', 'owner'), recordStockCountHandler);
router.get('/', authenticate, requireRole('owner'), listStockCountsHandler);
// Stock Count Center redesign (2026-09-12, CLAUDE.md #37) — stat cards +
// Recent Activity sidebar; owner-only like the rest of this queue. Static
// paths registered before the reason they'd otherwise never be reached is
// irrelevant here (no /:id GET exists on this router), but kept above the
// /:id/approve /:id/reject routes for readability/consistency with the
// other approval routers in this codebase.
router.get('/summary', authenticate, requireRole('owner'), getStockCountSummaryHandler);
router.get('/recent-activity', authenticate, requireRole('owner'), getStockCountRecentActivityHandler);
router.post('/:id/approve', authenticate, requireRole('owner'), approveStockCountHandler);
router.post('/:id/reject', authenticate, requireRole('owner'), rejectStockCountHandler);

export default router;
