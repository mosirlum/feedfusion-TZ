import { Request, Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service';

export async function getTodayDashboardHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await dashboardService.getTodayDashboard());
  } catch (err) {
    next(err);
  }
}
