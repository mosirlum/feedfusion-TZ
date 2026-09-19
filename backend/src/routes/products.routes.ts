import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  listProductsHandler,
  searchProductsHandler,
  createProductHandler,
  getProductHandler,
  updateProductHandler,
  deleteProductHandler,
  getStockLevelsHandler,
} from '../controllers/products.controller';
import { submitProposalHandler } from '../controllers/priceProposals.controller';
import { getStockHistoryHandler } from '../controllers/inventory.controller';

const router = Router();

router.get('/search', authenticate, searchProductsHandler);
// Quantity-only, no cost — open to any authenticated role (2026-09-11, New
// Sale page redesign), unlike the owner-only /inventory below which also
// carries cost/stock-value fields. Static segment before /:id.
router.get('/stock-levels', authenticate, getStockLevelsHandler);
router.get('/:id/stock-history', authenticate, requireRole('owner'), getStockHistoryHandler);
router.post('/:id/price-proposals', authenticate, submitProposalHandler);
router.get('/', authenticate, listProductsHandler);
router.post('/', authenticate, createProductHandler);
router.get('/:id', authenticate, getProductHandler);
router.patch('/:id', authenticate, requireRole('owner'), updateProductHandler);
router.delete('/:id', authenticate, requireRole('owner'), deleteProductHandler);

export default router;
