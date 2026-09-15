import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as customersService from '../services/customers.service';
import { isValidTzPhone } from '../utils/phone';

export async function listCustomersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await customersService.listCustomers());
  } catch (err) {
    next(err);
  }
}

// Backs the Quotation form's "Ship To" autocomplete — ?q= is optional
// (empty returns the most recently added customers).
export async function searchCustomersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.status(200).json(await customersService.searchCustomers(q));
  } catch (err) {
    next(err);
  }
}

export async function createCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, phone, email, address, notes } = req.body ?? {};
    if (phone && !isValidTzPhone(phone)) {
      throw new HttpError(400, 'INVALID_PHONE_FORMAT');
    }
    res.status(201).json(await customersService.createCustomer({ name, phone, email, address, notes }, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function updateCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_CUSTOMER_ID');
    const { name, phone, email, address, notes, status } = req.body ?? {};
    if (phone && !isValidTzPhone(phone)) {
      throw new HttpError(400, 'INVALID_PHONE_FORMAT');
    }
    res.status(200).json(await customersService.updateCustomer(id, { name, phone, email, address, notes, status }, req.user!));
  } catch (err) {
    next(err);
  }
}
