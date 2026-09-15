import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as purchasesService from '../services/purchases.service';

export async function createPurchaseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { supplierId, referenceNumber, purchaseDate, additionalCosts, additionalCostLines, notes, documentDataUrl, items } =
      req.body ?? {};
    // referenceNumber is intentionally optional here — createPurchase generates
    // a sequential one (PO-<year>-<0001, 0002, ...>) when it's blank. Requiring
    // it at this layer would contradict that and reject a legitimate blank field.
    if (!supplierId || !Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, 'SUPPLIER_AND_ITEMS_REQUIRED');
    }
    const purchase = await purchasesService.createPurchase({
      supplierId,
      referenceNumber,
      purchaseDate,
      additionalCosts: additionalCosts ?? 0,
      additionalCostLines,
      notes,
      documentDataUrl,
      items,
      createdBy: req.user!,
    });
    res.status(201).json(purchase);
  } catch (err) {
    next(err);
  }
}

export async function nextReferenceNumberHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const referenceNumber = await purchasesService.previewNextReferenceNumber();
    res.status(200).json({ referenceNumber });
  } catch (err) {
    next(err);
  }
}

export async function getPurchaseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PURCHASE_ID');
    res.status(200).json(await purchasesService.getPurchaseById(id));
  } catch (err) {
    next(err);
  }
}

export async function listPurchasesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await purchasesService.listPurchases());
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Purchase edit requests — correcting a mistake on an already-recorded
// purchase. See purchases.service.ts for the full design notes.
// ---------------------------------------------------------------------------

export async function requestPurchaseEditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_PURCHASE_ID');
    const { items, costLines, reason } = req.body ?? {};
    if ((!Array.isArray(items) || items.length === 0) && (!Array.isArray(costLines) || costLines.length === 0)) {
      throw new HttpError(400, 'NOTHING_TO_CHANGE');
    }
    const result = await purchasesService.requestPurchaseEdit({
      purchaseId: id,
      items: items ?? [],
      costLines: costLines ?? [],
      reason,
      requester: req.user!,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listPurchaseEditRequestsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.status(200).json(await purchasesService.listEditRequests(status));
  } catch (err) {
    next(err);
  }
}

export async function approvePurchaseEditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_EDIT_REQUEST_ID');
    const { notes } = req.body ?? {};
    res.status(200).json(await purchasesService.approvePurchaseEdit(id, req.user!, notes));
  } catch (err) {
    next(err);
  }
}

export async function rejectPurchaseEditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_EDIT_REQUEST_ID');
    const { notes } = req.body ?? {};
    res.status(200).json(await purchasesService.rejectPurchaseEdit(id, req.user!, notes));
  } catch (err) {
    next(err);
  }
}
