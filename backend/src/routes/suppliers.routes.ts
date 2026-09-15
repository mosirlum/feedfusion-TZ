import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  listSuppliersHandler,
  createSupplierHandler,
  getSupplierPurchasesHandler,
  updateSupplierHandler,
  getSupplierStatsHandler,
} from '../controllers/suppliers.controller';

const router = Router();

// list/create opened to 'sales' on 2026-09-11 — the Purchases form (now
// usable by sales staff too, see purchases.routes.ts) needs the supplier
// list and its inline "add a new supplier" action. Purchase history,
// editing, and the stats used by the redesigned Suppliers page all stay
// owner-only — they're only used from the owner-only Suppliers management
// page (navConfig.ts / App.tsx keep '/suppliers' owner-only).
router.get('/', authenticate, requireRole('owner', 'sales'), listSuppliersHandler);
router.post('/', authenticate, requireRole('owner', 'sales'), createSupplierHandler);
// Static segment before the dynamic /:id/purchases below — same Express
// ordering rule used elsewhere in this codebase (see purchases.routes.ts).
router.get('/stats', authenticate, requireRole('owner'), getSupplierStatsHandler);
router.get('/:id/purchases', authenticate, requireRole('owner'), getSupplierPurchasesHandler);
router.patch('/:id', authenticate, requireRole('owner'), updateSupplierHandler);

export default router;
