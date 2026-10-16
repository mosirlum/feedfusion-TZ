import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  previewNextDeliveryNoteNumberHandler,
  createDeliveryNoteHandler,
  listDeliveryNotesHandler,
  getDeliveryNoteHandler,
  updateDeliveryNoteStatusHandler,
  linkDeliveryNoteHandler,
  deleteDeliveryNoteHandler,
} from '../controllers/deliveryNotes.controller';

const router = Router();

// New Delivery Notes module (2026-10-16) — open to every authenticated role,
// same as POS/Sales/Quotations: any staff member who hands goods to a
// customer must be able to issue one. Static segments before /:id.
router.get('/next-number', authenticate, previewNextDeliveryNoteNumberHandler);
router.get('/', authenticate, listDeliveryNotesHandler);
router.post('/', authenticate, createDeliveryNoteHandler);
router.get('/:id', authenticate, getDeliveryNoteHandler);
router.patch('/:id/status', authenticate, updateDeliveryNoteStatusHandler);
router.patch('/:id/link-sale', authenticate, linkDeliveryNoteHandler);
// Delete = owner only, and only for a cancelled note (enforced in the service).
router.delete('/:id', authenticate, requireRole('owner'), deleteDeliveryNoteHandler);

export default router;
