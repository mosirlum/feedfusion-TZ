import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { getSettingsHandler, updateSettingsHandler } from '../controllers/settings.controller';

const router = Router();

// Business Settings (2026-09-12, CLAUDE.md #49) — read is open to every
// authenticated role (a printed Quotation's business header/bank details
// need it regardless of who's creating the quotation, same as how receipts
// already show business info to any role); only the owner can change it.
router.get('/', authenticate, getSettingsHandler);
router.patch('/', authenticate, requireRole('owner'), updateSettingsHandler);

export default router;
