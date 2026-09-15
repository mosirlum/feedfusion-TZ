import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { listCategoriesHandler, createCategoryHandler } from '../controllers/categories.controller';

const router = Router();

router.get('/', authenticate, listCategoriesHandler);
router.post('/', authenticate, requireRole('owner'), createCategoryHandler);

export default router;
