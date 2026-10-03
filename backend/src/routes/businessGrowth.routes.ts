import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { businessGrowthHandler } from '../controllers/businessGrowth.controller';

// Business Growth (2026-10-03, CLAUDE.md #73) — owner-only, same gating as
// reports.routes.ts since this is derived analysis over the same data.
const router = Router();

router.get('/', authenticate, requireRole('owner'), businessGrowthHandler);

export default router;
