import { Request, Response, NextFunction } from 'express';
import * as cashCountsService from '../services/cashCounts.service';

export async function recordCashCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { countDate, actualCash, notes } = req.body ?? {};
    const count = await cashCountsService.recordCashCount({
      countDate,
      actualCash,
      notes,
      countedBy: req.user!,
    });
    res.status(201).json(count);
  } catch (err) {
    next(err);
  }
}

export async function listCashCountsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    res.status(200).json(await cashCountsService.listCashCounts({ from, to }));
  } catch (err) {
    next(err);
  }
}

export async function getCashControlSummaryHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await cashCountsService.getCashControlSummary());
  } catch (err) {
    next(err);
  }
}
