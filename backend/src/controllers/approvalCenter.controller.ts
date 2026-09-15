import { Request, Response, NextFunction } from 'express';
import * as approvalCenterService from '../services/approvalCenter.service';

export async function getApprovalSummaryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await approvalCenterService.getApprovalSummary());
  } catch (err) {
    next(err);
  }
}

export async function getRecentActivityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit) || 8;
    res.status(200).json(await approvalCenterService.getRecentActivity(limit));
  } catch (err) {
    next(err);
  }
}
