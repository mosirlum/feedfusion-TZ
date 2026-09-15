import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as inventoryService from '../services/inventory.service';

export async function getInventoryHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await inventoryService.getInventory());
  } catch (err) {
    next(err);
  }
}

export async function getLowStockHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await inventoryService.getLowStock());
  } catch (err) {
    next(err);
  }
}

export async function getStockHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PRODUCT_ID');
    res.status(200).json(await inventoryService.getStockHistory(id));
  } catch (err) {
    next(err);
  }
}
