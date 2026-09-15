import { Request, Response, NextFunction } from 'express';
import * as settingsService from '../services/settings.service';

export async function getSettingsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingsService.getSettings());
  } catch (err) {
    next(err);
  }
}

export async function updateSettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      businessName,
      phone,
      email,
      address,
      tin,
      currency,
      defaultMaxDiscountPct,
      bankAccountName,
      bankAccountNumber,
      bankName,
      bankSwift,
      bankBranch,
      vatRatePct,
      quotationValidityDays,
      mobileMoney1Number,
      mobileMoney1Label,
      mobileMoney2Number,
      mobileMoney2Label,
      invoiceTerms,
    } = req.body ?? {};
    res.status(200).json(
      await settingsService.updateSettings(
        {
          businessName,
          phone,
          email,
          address,
          tin,
          currency,
          defaultMaxDiscountPct,
          bankAccountName,
          bankAccountNumber,
          bankName,
          bankSwift,
          bankBranch,
          vatRatePct,
          quotationValidityDays,
          mobileMoney1Number,
          mobileMoney1Label,
          mobileMoney2Number,
          mobileMoney2Label,
          invoiceTerms,
        },
        req.user!
      )
    );
  } catch (err) {
    next(err);
  }
}
