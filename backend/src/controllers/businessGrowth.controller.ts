import { Request, Response, NextFunction } from 'express';
import * as businessGrowthService from '../services/businessGrowth.service';

// Business Growth (2026-10-03, CLAUDE.md #73) — single read-only endpoint;
// all the analysis logic lives in the service, same thin-controller
// pattern as reports.controller.ts's salesOverviewHandler.
export async function businessGrowthHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await businessGrowthService.getBusinessGrowthAnalysis());
  } catch (err) {
    next(err);
  }
}
