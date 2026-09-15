import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { listAuditLogsHandler } from '../controllers/auditLogs.controller';

const router = Router();

router.get('/', authenticate, requireRole('owner'), listAuditLogsHandler);

export default router;
