import { Request, Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service';

export async function getTodayDashboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await dashboardService.getTodayDashboard(req.user!.id));
  } catch (err) {
    next(err);
  }
}

function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' ? v : undefined;
}

// Custom-range Profit & Loss (2026-09-19, CLAUDE.md #69 follow-up) — backs
// the dashboard's hidden-by-default "Custom range" button.
export async function getProfitAndLossHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await dashboardService.getProfitAndLossForRange(q(req, 'from'), q(req, 'to'), req.user!.id));
  } catch (err) {
    next(err);
  }
}
