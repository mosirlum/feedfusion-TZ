import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  listProposalsHandler,
  approveProposalHandler,
  rejectProposalHandler,
} from '../controllers/priceProposals.controller';

const router = Router();

router.get('/', authenticate, requireRole('owner'), listProposalsHandler);
router.post('/:id/approve', authenticate, requireRole('owner'), approveProposalHandler);
router.post('/:id/reject', authenticate, requireRole('owner'), rejectProposalHandler);

export default router;
