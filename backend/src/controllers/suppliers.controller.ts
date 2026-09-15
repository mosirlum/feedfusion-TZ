import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as suppliersService from '../services/suppliers.service';
import { isValidTzPhone } from '../utils/phone';

export async function listSuppliersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await suppliersService.listSuppliers());
  } catch (err) {
    next(err);
  }
}

export async function createSupplierHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, phone, email, address, notes } = req.body ?? {};
    if (phone && !isValidTzPhone(phone)) {
      throw new HttpError(400, 'INVALID_PHONE_FORMAT');
    }
    res.status(201).json(await suppliersService.createSupplier({ name, phone, email, address, notes }));
  } catch (err) {
    next(err);
  }
}

export async function getSupplierPurchasesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SUPPLIER_ID');
    res.status(200).json(await suppliersService.getPurchasesForSupplier(id));
  } catch (err) {
    next(err);
  }
}

export async function updateSupplierHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SUPPLIER_ID');
    const { name, phone, email, address, notes, status } = req.body ?? {};
    if (phone && !isValidTzPhone(phone)) {
      throw new HttpError(400, 'INVALID_PHONE_FORMAT');
    }
    res.status(200).json(await suppliersService.updateSupplier(id, { name, phone, email, address, notes, status }));
  } catch (err) {
    next(err);
  }
}

export async function getSupplierStatsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await suppliersService.getSupplierStats());
  } catch (err) {
    next(err);
  }
}
