import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as stockCountsService from '../services/stockCounts.service';

export async function recordStockCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { productId, physicalQty, reason, notes } = req.body ?? {};
    if (!Number.isInteger(productId)) throw new HttpError(400, 'PRODUCT_ID_REQUIRED');
    if (typeof physicalQty !== 'number' || !Number.isFinite(physicalQty)) {
      throw new HttpError(400, 'PHYSICAL_QTY_REQUIRED');
    }
    if (!reason) throw new HttpError(400, 'REASON_REQUIRED');
    const count = await stockCountsService.recordStockCount({
      productId,
      physicalQty,
      reason,
      notes,
      countedBy: req.user!,
    });
    res.status(201).json(count);
  } catch (err) {
    next(err);
  }
}

export async function approveStockCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_STOCK_COUNT_ID');
    res.status(200).json(await stockCountsService.approveStockCount(id, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function rejectStockCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_STOCK_COUNT_ID');
    res.status(200).json(await stockCountsService.rejectStockCount(id, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function listStockCountsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await stockCountsService.listStockCounts());
  } catch (err) {
    next(err);
  }
}

export async function getStockCountSummaryHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await stockCountsService.getStockCountSummary());
  } catch (err) {
    next(err);
  }
}

export async function getStockCountRecentActivityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit) || 8;
    res.status(200).json(await stockCountsService.getRecentActivity(limit));
  } catch (err) {
    next(err);
  }
}
