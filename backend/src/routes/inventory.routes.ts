import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { getInventoryHandler } from '../controllers/inventory.controller';

const router = Router();

router.get('/', authenticate, requireRole('owner'), getInventoryHandler);

export default router;
