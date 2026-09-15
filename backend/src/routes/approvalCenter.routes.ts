import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { getApprovalSummaryHandler, getRecentActivityHandler } from '../controllers/approvalCenter.controller';

const router = Router();

// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — owner-only,
// same as every individual approval queue these two aggregate.
router.get('/summary', authenticate, requireRole('owner'), getApprovalSummaryHandler);
router.get('/recent-activity', authenticate, requireRole('owner'), getRecentActivityHandler);

export default router;
