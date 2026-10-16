import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as deliveryNotesService from '../services/deliveryNotes.service';

function parseId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_DELIVERY_NOTE_ID');
  return id;
}

export async function previewNextDeliveryNoteNumberHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ deliveryNoteNumber: await deliveryNotesService.previewNextDeliveryNoteNumber() });
  } catch (err) {
    next(err);
  }
}

export async function createDeliveryNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      customerId, customerName, customerPhone, deliveryAddress, deliveryDate,
      driverName, vehicleNumber, reference, notes, invoiceNumber, items,
    } = req.body ?? {};
    res.status(201).json(
      await deliveryNotesService.createDeliveryNote(
        { customerId, customerName, customerPhone, deliveryAddress, deliveryDate, driverName, vehicleNumber, reference, notes, invoiceNumber, items },
        req.user!
      )
    );
  } catch (err) {
    next(err);
  }
}

export async function listDeliveryNotesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await deliveryNotesService.listDeliveryNotes());
  } catch (err) {
    next(err);
  }
}

export async function getDeliveryNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await deliveryNotesService.getDeliveryNote(parseId(req)));
  } catch (err) {
    next(err);
  }
}

export async function updateDeliveryNoteStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await deliveryNotesService.updateDeliveryNoteStatus(parseId(req), req.body?.status, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function linkDeliveryNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await deliveryNotesService.linkDeliveryNoteToSale(parseId(req), req.body?.invoiceNumber, req.user!));
  } catch (err) {
    next(err);
  }
}
