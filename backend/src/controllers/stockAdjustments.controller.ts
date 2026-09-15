import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as stockAdjustmentsService from '../services/stockAdjustments.service';

export async function createStockAdjustmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { productId, quantity, reason, notes } = req.body ?? {};
    if (!Number.isInteger(productId)) throw new HttpError(400, 'PRODUCT_ID_REQUIRED');
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      throw new HttpError(400, 'QUANTITY_MUST_BE_INTEGER');
    }
    if (!reason) throw new HttpError(400, 'REASON_REQUIRED');
    const adjustment = await stockAdjustmentsService.createStockAdjustment({
      productId,
      quantity,
      reason,
      notes,
      createdBy: req.user!,
    });
    res.status(201).json(adjustment);
  } catch (err) {
    next(err);
  }
}

export async function listStockAdjustmentsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await stockAdjustmentsService.listStockAdjustments());
  } catch (err) {
    next(err);
  }
}

export async function getStockAdjustmentsSummaryHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await stockAdjustmentsService.getStockAdjustmentsSummary());
  } catch (err) {
    next(err);
  }
}
