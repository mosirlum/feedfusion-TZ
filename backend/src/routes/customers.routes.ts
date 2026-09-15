import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listCustomersHandler,
  searchCustomersHandler,
  createCustomerHandler,
  updateCustomerHandler,
} from '../controllers/customers.controller';

const router = Router();

// New Customers module (2026-09-12, Quotations feature, CLAUDE.md #49) —
// open to every authenticated role, same as Sales/the POS itself, since
// any role can create a Quotation and needs to search/add a customer while
// doing it. Static /search segment before the dynamic /:id, same ordering
// rule used elsewhere in this codebase (see purchases.routes.ts).
router.get('/', authenticate, listCustomersHandler);
router.get('/search', authenticate, searchCustomersHandler);
router.post('/', authenticate, createCustomerHandler);
router.patch('/:id', authenticate, updateCustomerHandler);

export default router;
