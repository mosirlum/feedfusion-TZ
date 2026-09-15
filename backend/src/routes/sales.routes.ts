import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  completeSaleHandler,
  getSaleHandler,
  listSalesHandler,
  salesStatsHandler,
  updateSaleHandler,
  requestSaleEditHandler,
  listSaleEditRequestsHandler,
  approveSaleEditHandler,
  rejectSaleEditHandler,
  voidSaleHandler,
  getReceiptHandler,
  nextInvoiceNumberHandler,
  markSalePrintedHandler,
  recordPaymentHandler,
} from '../controllers/sales.controller';

const router = Router();

router.post('/', authenticate, completeSaleHandler);
// Opened beyond owner 2026-09-11 (Sales History redesign, CLAUDE.md #34) —
// a sales/manager requester is scoped to their own served sales inside
// salesService.listSales/getSalesStats (ownerView), same pattern as
// getSaleById's existing 403 check just below. No requireRole here.
router.get('/', authenticate, listSalesHandler);
router.get('/stats', authenticate, salesStatsHandler);
// Static segments before /:id — otherwise Express would match them as the
// :id param (same ordering rule as purchases.routes.ts's /next-reference).
router.get('/next-invoice-number', authenticate, nextInvoiceNumberHandler);
// Change Approval Center (2026-09-11, CLAUDE.md #35) — the approval queue
// itself stays owner-only, same as Price Approvals/Purchase edit requests.
router.get('/edit-requests', authenticate, requireRole('owner'), listSaleEditRequestsHandler);
router.post('/edit-requests/:id/approve', authenticate, requireRole('owner'), approveSaleEditHandler);
router.post('/edit-requests/:id/reject', authenticate, requireRole('owner'), rejectSaleEditHandler);
router.get('/:id', authenticate, getSaleHandler);
router.get('/:id/receipt', authenticate, getReceiptHandler);
// Non-financial edit (immediate) — access is scoped inside the service
// (own sales only for a non-owner), same as GET /:id above.
router.patch('/:id', authenticate, updateSaleHandler);
// Financial edit (creates a request; owner's own auto-approves inside the
// service, same pattern as purchases.routes.ts's equivalent).
router.post('/:id/edit-requests', authenticate, requestSaleEditHandler);
router.post('/:id/void', authenticate, requireRole('owner'), voidSaleHandler);
// Invoice print tracking (2026-09-12, CLAUDE.md #47) — access scoped inside
// the service exactly like GET /:id/PATCH /:id above (own sales only for a
// non-owner).
router.post('/:id/mark-printed', authenticate, markSalePrintedHandler);
// Credit sales (2026-09-12, CLAUDE.md #50) — top up a PARTIAL sale's balance
// later. Access scoped inside the service exactly like GET/PATCH /:id above
// (own sales only for a non-owner).
router.post('/:id/payments', authenticate, recordPaymentHandler);

export default router;
