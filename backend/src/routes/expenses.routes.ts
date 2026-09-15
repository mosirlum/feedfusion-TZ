import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { createExpenseHandler, listExpensesHandler } from '../controllers/expenses.controller';

const router = Router();

router.get('/', authenticate, requireRole('owner'), listExpensesHandler);
router.post('/', authenticate, requireRole('owner'), createExpenseHandler);

export default router;
