import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  previewNextQuotationNumberHandler,
  createQuotationHandler,
  listQuotationsHandler,
  getQuotationHandler,
  updateQuotationStatusHandler,
  convertQuotationHandler,
} from '../controllers/quotations.controller';

const router = Router();

// New Quotations module (2026-09-12, CLAUDE.md #49) — open to every
// authenticated role, same as POS/Sales: any role can create a quotation
// for a walk-in or saved customer, and the list isn't scoped to "own"
// (unlike Sales History's profit-sensitive figures) since a quotation is a
// shared, customer-facing document any staff member may need to find.
// Static segments before the dynamic /:id, same ordering rule used
// elsewhere in this codebase (see purchases.routes.ts).
router.get('/next-number', authenticate, previewNextQuotationNumberHandler);
router.get('/', authenticate, listQuotationsHandler);
router.post('/', authenticate, createQuotationHandler);
router.get('/:id', authenticate, getQuotationHandler);
router.patch('/:id/status', authenticate, updateQuotationStatusHandler);
router.post('/:id/convert', authenticate, convertQuotationHandler);

export default router;
