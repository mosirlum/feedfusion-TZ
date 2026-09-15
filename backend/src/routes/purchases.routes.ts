import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  createPurchaseHandler,
  getPurchaseHandler,
  listPurchasesHandler,
  nextReferenceNumberHandler,
  requestPurchaseEditHandler,
  listPurchaseEditRequestsHandler,
  approvePurchaseEditHandler,
  rejectPurchaseEditHandler,
} from '../controllers/purchases.controller';

const router = Router();

// Opened up to 'sales' on 2026-09-11 (previously owner-only) so staff can
// record purchases too — the reason the edit-request/approval flow below
// exists at all. See CLAUDE.md for the full design writeup.
router.post('/', authenticate, requireRole('owner', 'sales'), createPurchaseHandler);
router.get('/', authenticate, requireRole('owner', 'sales'), listPurchasesHandler);
// Static segments must come before /:id — otherwise Express would match
// them as the :id param.
router.get('/next-reference', authenticate, requireRole('owner', 'sales'), nextReferenceNumberHandler);
// The approval queue itself stays owner-only, same as Price Approvals.
router.get('/edit-requests', authenticate, requireRole('owner'), listPurchaseEditRequestsHandler);
router.get('/:id', authenticate, requireRole('owner', 'sales'), getPurchaseHandler);
// Either role can submit a correction; only the owner ever gets to decide
// what happens to it (their own submission auto-approves inside the
// service — see purchases.service.ts — a sales user's sits PENDING here).
router.post('/:id/edit-requests', authenticate, requireRole('owner', 'sales'), requestPurchaseEditHandler);
router.post('/edit-requests/:id/approve', authenticate, requireRole('owner'), approvePurchaseEditHandler);
router.post('/edit-requests/:id/reject', authenticate, requireRole('owner'), rejectPurchaseEditHandler);

export default router;
