import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { loginHandler, refreshHandler, logoutHandler, changePasswordHandler } from '../controllers/auth.controller';

const router = Router();

router.post('/login', loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout', authenticate, logoutHandler);
// Self-service password change (2026-09-12, CLAUDE.md #47) — used both for
// the forced first-login/post-reset change and a voluntary change from My
// Profile; any authenticated user, no role restriction.
router.post('/change-password', authenticate, changePasswordHandler);

export default router;
