import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as quotationsService from '../services/quotations.service';

export async function previewNextQuotationNumberHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ quotationNumber: await quotationsService.previewNextQuotationNumber() });
  } catch (err) {
    next(err);
  }
}

export async function createQuotationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { customerId, customerName, customerPhone, customerAddress, validUntil, reference, notes, items } = req.body ?? {};
    res.status(201).json(
      await quotationsService.createQuotation(
        { customerId, customerName, customerPhone, customerAddress, validUntil, reference, notes, items },
        req.user!
      )
    );
  } catch (err) {
    next(err);
  }
}

export async function listQuotationsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await quotationsService.listQuotations());
  } catch (err) {
    next(err);
  }
}

export async function getQuotationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_QUOTATION_ID');
    res.status(200).json(await quotationsService.getQuotation(id));
  } catch (err) {
    next(err);
  }
}

export async function updateQuotationStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_QUOTATION_ID');
    const { status } = req.body ?? {};
    res.status(200).json(await quotationsService.updateQuotationStatus(id, status, req.user!));
  } catch (err) {
    next(err);
  }
}

// Convert to Sale (CLAUDE.md #49) — called by the frontend right after POS
// has completed the real sale, carrying that sale's id.
export async function convertQuotationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_QUOTATION_ID');
    const saleId = Number(req.body?.saleId);
    if (!Number.isInteger(saleId)) throw new HttpError(400, 'INVALID_SALE_ID');
    res.status(200).json(await quotationsService.convertQuotationToSale(id, saleId, req.user!));
  } catch (err) {
    next(err);
  }
}
