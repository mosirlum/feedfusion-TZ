import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../middleware/errorHandler';
import * as salesService from '../services/sales.service';
import { getBusinessSettings } from '../db/businessSettingsRepo';

/**
 * api-reference.md's "Sale creation body shape" example is snake_case
 * (product_id, payment_amount) — matching that documented contract exactly
 * here, then translating into the service layer's camelCase input shape.
 * (Flagged deviation fixed: an earlier draft of this handler read camelCase
 * field names directly from the body, which would have silently rejected
 * every request built against the documented API shape.)
 *
 * `discount_pin` was removed from this contract (2026-09-13, CLAUDE.md #66)
 * along with the owner-PIN gate on over-limit discounts — a caller still
 * sending it is simply ignored rather than erroring, so an unrefreshed
 * client doesn't break.
 */
export async function completeSaleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      items,
      payment_amount,
      // Credit sales (2026-09-12, CLAUDE.md #50) — payment_method defaults to
      // 'CASH' so an older client still on the pre-credit-sales contract
      // keeps working unchanged. customer_phone/customer_address/customer_id
      // are new "Sold To" fields, same snapshot-at-creation pattern already
      // used for customer_name and for Quotations' own Ship To.
      payment_method,
      customer_name,
      customer_phone,
      customer_address,
      customer_id,
      // Backdated sale entry + "Give on Credit" due date (2026-09-25,
      // owner's request, migration 021) — both optional "YYYY-MM-DD"
      // strings; validated in the service layer.
      sale_date,
      due_date,
    } = req.body ?? {};
    if (!Array.isArray(items) || typeof payment_amount !== 'number') {
      throw new HttpError(400, 'ITEMS_AND_PAYMENT_AMOUNT_REQUIRED');
    }
    const mappedItems = items.map((item: any) => ({
      productId: item.product_id,
      quantity: item.quantity,
      discount: item.discount
        ? { type: item.discount.type, value: item.discount.value, reason: item.discount.reason }
        : undefined,
    }));
    const sale = await salesService.completeSale({
      items: mappedItems,
      paymentAmount: payment_amount,
      paymentMethod: payment_method === 'BANK_TRANSFER' || payment_method === 'MOBILE_MONEY' ? payment_method : 'CASH',
      customerName: customer_name,
      customerPhone: customer_phone,
      customerAddress: customer_address,
      customerId: typeof customer_id === 'number' ? customer_id : null,
      saleDate: typeof sale_date === 'string' ? sale_date : null,
      dueDate: typeof due_date === 'string' ? due_date : null,
      servedBy: req.user!,
    });
    res.status(201).json(sale);
  } catch (err) {
    next(err);
  }
}

// Top up a PARTIAL sale's remaining balance later (2026-09-12, CLAUDE.md
// #50) — "mzigo unatoka sasa, malipo yanakuja baadaye."
export async function recordPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SALE_ID');
    const { amount, method } = req.body ?? {};
    if (typeof amount !== 'number') {
      throw new HttpError(400, 'AMOUNT_REQUIRED');
    }
    const safeMethod = method === 'BANK_TRANSFER' || method === 'MOBILE_MONEY' ? method : 'CASH';
    res.status(200).json(await salesService.recordPayment(id, { amount, method: safeMethod }, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function nextInvoiceNumberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const invoiceNumber = await salesService.previewNextInvoiceNumber();
    res.status(200).json({ invoiceNumber });
  } catch (err) {
    next(err);
  }
}

export async function getSaleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SALE_ID');
    res.status(200).json(await salesService.getSaleById(id, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function listSalesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const servedBy = req.query.served_by ? Number(req.query.served_by) : undefined;
    const status = req.query.status === 'COMPLETED' || req.query.status === 'VOIDED' ? req.query.status : undefined;
    const productId = req.query.product_id ? Number(req.query.product_id) : undefined;
    const search = typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim() : undefined;
    res.status(200).json(
      await salesService.listSales({ date, from, to, servedBy, status, productId, search }, req.user!)
    );
  } catch (err) {
    next(err);
  }
}

// 2026-09-11 (Sales History redesign, CLAUDE.md #34) — powers the stat
// cards. Any authenticated role may call this (unlike the owner-only
// GET /inventory equivalent), because the service strips gross_profit for
// a non-owner requester rather than the route gating the whole endpoint.
export async function salesStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (!from || !to) {
      throw new HttpError(400, 'FROM_AND_TO_REQUIRED');
    }
    const servedBy = req.query.served_by ? Number(req.query.served_by) : undefined;
    res.status(200).json(await salesService.getSalesStats({ from, to, servedBy }, req.user!));
  } catch (err) {
    next(err);
  }
}

// Change Approval Center (2026-09-11, CLAUDE.md #35) — the non-financial
// half of "Edit": customer_name/customer_phone/notes save immediately, no
// approval. snake_case body, matching this API's existing convention
// (completeSaleHandler above translates the same way).
export async function updateSaleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SALE_ID');
    const { customer_name, customer_phone, notes } = req.body ?? {};
    res.status(200).json(
      await salesService.updateSaleDetails(
        id,
        { customerName: customer_name, customerPhone: customer_phone, notes },
        req.user!
      )
    );
  } catch (err) {
    next(err);
  }
}

// The financial half of "Edit" — an existing line's quantity/unit
// price/discount never change the sale directly; this always creates an
// edit request (auto-approved immediately if the owner submits it).
export async function requestSaleEditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SALE_ID');
    const { items, reason } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, 'NOTHING_TO_CHANGE');
    }
    const mappedItems = items.map((item: any) => ({
      saleItemId: item.sale_item_id,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      discountType: item.discount_type ?? 'NONE',
      discountValue: item.discount_value ?? 0,
      discountReason: item.discount_reason ?? null,
    }));
    const result = await salesService.requestSaleEdit({ saleId: id, items: mappedItems, reason, requester: req.user! });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listSaleEditRequestsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.status(200).json(await salesService.listSaleEditRequests(status));
  } catch (err) {
    next(err);
  }
}

export async function approveSaleEditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_EDIT_REQUEST_ID');
    const { notes } = req.body ?? {};
    res.status(200).json(await salesService.approveSaleEdit(id, req.user!, notes));
  } catch (err) {
    next(err);
  }
}

export async function rejectSaleEditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_EDIT_REQUEST_ID');
    const { notes } = req.body ?? {};
    res.status(200).json(await salesService.rejectSaleEdit(id, req.user!, notes));
  } catch (err) {
    next(err);
  }
}

export async function voidSaleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SALE_ID');
    const { reason } = req.body ?? {};
    res.status(200).json(await salesService.voidSale(id, reason, req.user!));
  } catch (err) {
    next(err);
  }
}

// Invoice print tracking (2026-09-12, CLAUDE.md #47) — called from the POS
// "Sale Complete" modal and Sales History's own print button, right before
// window.print() fires. Idempotent — printing twice never changes the
// recorded printed_at a second time.
export async function markSalePrintedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SALE_ID');
    res.status(200).json(await salesService.markSalePrinted(id, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function getReceiptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'INVALID_SALE_ID');
    const sale = await salesService.getSaleById(id, req.user!);
    const business = await getBusinessSettings();
    res.status(200).json({
      invoice_number: sale.invoice_number,
      sale_date: sale.sale_date,
      served_by_name: sale.served_by_name,
      customer_name_or_walkin: sale.customer_name || 'Walk-in customer',
      // "Sold To" details (2026-09-12, CLAUDE.md #50) — null unless the
      // cashier actually captured them; the receipt only renders a Sold To
      // block at all when there's a name beyond the bare walk-in fallback.
      customer_phone: sale.customer_phone ?? null,
      customer_address: sale.customer_address ?? null,
      items: sale.items.map((item: any) => ({
        product_name: item.product_name,
        // Product unit ('Bag', 'Kg', ...) — the join already pulled this
        // into `sale.items` (salesRepo.ts's attachItemsAndPayments query
        // selects `p.unit`), it just wasn't passed through here before the
        // invoice redesign (2026-09-12, CLAUDE.md #51) added a Unit column.
        unit: item.unit ?? null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_subtotal: item.line_subtotal,
        discount_amount: item.discount_amount,
        discount_reason: item.discount_reason,
      })),
      subtotal: sale.subtotal,
      total_discount: sale.total_discount,
      total: sale.total,
      status: sale.status,
      // Invoice redesign (2026-09-12, CLAUDE.md #51) — the agreed invoice
      // layout's header shows the business TIN (already printed on
      // Quotations) and a Notes/Terms box backed by the sale's own
      // `notes` column (added for the Change Approval Center's
      // non-financial sale edits, CLAUDE.md #35) — both were already real
      // data, just never surfaced on the receipt endpoint before.
      business_tin: business.tin ?? null,
      // Falls back to the standard Business Settings terms text
      // (2026-09-12, CLAUDE.md #54) when this specific sale has no note of
      // its own — the owner's own request: a boilerplate line like
      // "Payment is due in advance..." shouldn't need retyping on every
      // sale via Edit Sale, it should live in Settings like Bank Details
      // does. A genuinely one-off note on a specific sale still overrides
      // this, unchanged from #52.
      notes: sale.notes || business.invoice_terms || null,
      // Credit sales (2026-09-12, CLAUDE.md #50) — payment_status/
      // amount_paid/balance_due let the receipt show "PAID IN FULL" vs.
      // "PARTIALLY PAID — balance TZS X", and the payments list shows what
      // was actually collected and by which method(s).
      payment_status: sale.payment_status,
      amount_paid: sale.amount_paid,
      balance_due: sale.balance_due,
      payments: sale.payments.map((p: any) => ({ amount: p.amount, method: p.method, created_at: p.created_at })),
      business_name: business.business_name,
      business_address: business.address,
      business_phone: business.phone,
      business_email: business.email,
      // Bank + mobile money details (2026-09-12, CLAUDE.md #50) — same
      // fields Quotations already print; only actually shown on the receipt
      // when a balance is still owed (see ReceiptView.tsx), since a fully
      // paid cash sale has no further payment to collect.
      bank_account_name: business.bank_account_name,
      bank_account_number: business.bank_account_number,
      bank_name: business.bank_name,
      bank_swift: business.bank_swift,
      bank_branch: business.bank_branch,
      mobile_money_1_number: business.mobile_money_1_number,
      mobile_money_1_label: business.mobile_money_1_label,
      mobile_money_2_number: business.mobile_money_2_number,
      mobile_money_2_label: business.mobile_money_2_label,
    });
  } catch (err) {
    next(err);
  }
}
