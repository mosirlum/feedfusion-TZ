import { Request, Response, NextFunction } from 'express';
import { getAuditLogs } from '../services/auditLogs.service';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function int(v: unknown): number | undefined {
  return typeof v === 'string' && Number.isInteger(Number(v)) ? Number(v) : undefined;
}

export async function listAuditLogsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getAuditLogs({
      entityType: str(req.query.entity_type),
      entityId: int(req.query.entity_id),
      from: str(req.query.from),
      to: str(req.query.to),
      userId: int(req.query.user_id),
      action: str(req.query.action),
      feature: str(req.query.feature),
      page: int(req.query.page),
      pageSize: int(req.query.page_size),
      sortBy: str(req.query.sort_by),
      sortDir: str(req.query.sort_dir) === 'asc' ? 'asc' : str(req.query.sort_dir) === 'desc' ? 'desc' : undefined,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
