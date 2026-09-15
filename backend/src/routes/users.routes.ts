import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  listUsersHandler,
  createUserHandler,
  updateUserHandler,
  deleteUserHandler,
  resetPasswordHandler,
  updateOwnProfileHandler,
} from '../controllers/users.controller';

const router = Router();

router.get('/', authenticate, requireRole('owner'), listUsersHandler);
router.post('/', authenticate, requireRole('owner'), createUserHandler);
// Self-service profile (2026-09-12, CLAUDE.md #47) — name/phone/email/avatar
// only, any authenticated user, own account only. Static "/me" must come
// before "/:id" below, or Express would match it as the :id param (same
// ordering rule as purchases.routes.ts's /next-reference).
router.patch('/me', authenticate, updateOwnProfileHandler);
router.patch('/:id', authenticate, requireRole('owner'), updateUserHandler);
router.delete('/:id', authenticate, requireRole('owner'), deleteUserHandler);
// Owner resets someone else's forgotten password (2026-09-12, CLAUDE.md #47)
// — sets a new temporary password and forces a real change on next login.
router.post('/:id/reset-password', authenticate, requireRole('owner'), resetPasswordHandler);

export default router;
