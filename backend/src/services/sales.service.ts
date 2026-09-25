import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { HttpError } from '../middleware/errorHandler';
import * as productsRepo from '../db/productsRepo';
import * as stockMovementsRepo from '../db/stockMovementsRepo';
import * as salesRepo from '../db/salesRepo';
import * as usersRepo from '../db/usersRepo';
import * as saleEditRequestsRepo from '../db/saleEditRequestsRepo';
import { ProposedSaleItemPatch } from '../db/saleEditRequestsRepo';
import { getBusinessSettings } from '../db/businessSettingsRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';
import { previousPeriodRange, pctChange } from '../utils/period';

export interface SaleLineInput {
  productId: number;
  quantity: number;
  discount?: { type: 'FIXED' | 'PERCENT'; value: number; reason?: string };
}

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY';

export interface CompleteSaleInput {
  items: SaleLineInput[];
  paymentAmount: number;
  // Credit sales (2026-09-12, CLAUDE.md #50) — defaults to 'CASH' at the
  // controller for backward compatibility with any caller still on the old
  // cash-only contract.
  paymentMethod: PaymentMethod;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerId?: number | null;
  // Backdated sale entry (2026-09-25, owner's request) — "YYYY-MM-DD" for a
  // sale that actually happened on an earlier real day but is only being
  // entered into the system now. Optional; never in the future. Only the
  // reporting-facing sales.sale_date is backdated — every stock_movements
  // row this sale creates still gets its own real "now" as its
  // created_at, so the running stock-balance ledger (balance_after,
  // computed at insert time) never needs recalculating.
  saleDate?: string | null;
  // "Give on Credit" due date (2026-09-25, migration 021) — "YYYY-MM-DD".
  // Required whenever paymentAmount is exactly 0 (see the credit-sale
  // check below); optional on an ordinary PARTIAL sale.
  dueDate?: string | null;
  servedBy: AuthenticatedUser;
}

/** Postgres unique-violation is error code 23505; `column` narrows it to the specific constraint we're guarding against — same helper as purchases.service.ts's. */
function isUniqueViolation(err: unknown, column: string): boolean {
  const pgErr = err as { code?: string; constraint?: string; detail?: string } | null;
  return !!pgErr && pgErr.code === '23505' && (pgErr.constraint?.includes(column) || pgErr.detail?.includes(column)) === true;
}

/**
 * Sequential per-year invoice numbers (2026-09-11, New Sale page redesign),
 * replacing an earlier INV-<date>-<random hex> format — switched at the
 * owner's request to match the simple counting scheme Purchases already
 * uses (PO-2026-0001, 0002…): counts existing sales for the current year
 * and returns the next number, padded to 4 digits. Restarts at 0001 each
 * calendar year. Same caveat as Purchases' nextReferenceNumber: this counts
 * rows rather than using a dedicated sequence, which is simple and good
 * enough for a single shop — a genuine race between two near-simultaneous
 * completions is still caught below and surfaced as a clean, recoverable
 * error rather than silent data corruption.
 */
async function nextInvoiceNumber(queryable: PoolClient | typeof pool): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await queryable.query('SELECT COUNT(*)::int AS count FROM sales WHERE invoice_number LIKE $1', [
    `INV-${year}-%`,
  ]);
  const next = rows[0].count + 1;
  return `INV-${year}-${String(next).padStart(4, '0')}`;
}

/** For the New Sale page to show what the invoice number will look like before completing — not reserved, so it can shift if another sale completes first. */
export async function previewNextInvoiceNumber(): Promise<string> {
  return nextInvoiceNumber(pool);
}

/**
 * The sale-completion transaction — architecture.md calls this "the most
 * important piece of code in this system". Row locks on every product line
 * (in a stable, sorted order to avoid cross-sale deadlocks) plus a stock
 * re-check at commit time is what actually prevents two simultaneous sales
 * from overselling the same product (Section 16/BR-18/BR-19) — an
 * application-level check-then-write without the DB lock has a race
 * condition, per architecture.md's explicit warning.
 */
/**
 * Backdated sale entry (2026-09-25, owner's request) — validates a
 * caller-supplied "YYYY-MM-DD" sale date and combines it with the CURRENT
 * time-of-day, so a sale entered right now for "last Saturday" gets a
 * `sale_date` of last Saturday at this actual moment rather than midnight
 * (which would otherwise cluster every backdated sale of the same day at
 * exactly 00:00:00 and scramble their relative order in reports). Returns
 * `now` unchanged when no date was supplied — that's the pre-existing
 * behavior, just made explicit here instead of left to the DB's
 * `DEFAULT now()`.
 */
function resolveSaleDate(saleDate: string | null | undefined): Date {
  const now = new Date();
  if (!saleDate) return now;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(saleDate);
  if (!match) {
    throw new HttpError(400, 'INVALID_SALE_DATE');
  }
  const [, y, m, d] = match;
  const combined = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
  if (Number.isNaN(combined.getTime())) {
    throw new HttpError(400, 'INVALID_SALE_DATE');
  }
  // A minute of slack for clock/rounding noise — the real intent this
  // guards against is a date days/months in the future, not a few seconds
  // of drift between the browser and this server.
  if (combined.getTime() > now.getTime() + 60_000) {
    throw new HttpError(400, 'SALE_DATE_CANNOT_BE_IN_FUTURE');
  }
  return combined;
}

export async function completeSale(input: CompleteSaleInput) {
  if (!input.items || input.items.length === 0) {
    throw new HttpError(400, 'AT_LEAST_ONE_ITEM_REQUIRED'); // BR-03
  }

  const sortedItems = [...input.items].sort((a, b) => a.productId - b.productId);

  return withTransaction(async (client) => {
    const settings = await getBusinessSettings(client);
    const maxPct = Number(settings.default_max_discount_pct);

    let subtotal = 0;
    let totalDiscount = 0;
    // BR-31/BR-32 relaxed at the owner's explicit request (2026-09-13,
    // CLAUDE.md #66): a discount no longer needs a typed reason, and one
    // above the shop's limit no longer blocks the sale on an owner
    // PIN/password — it still gets flagged, both back to the cashier (as a
    // warning on the completed-sale response, see highDiscountWarnings
    // below) and into the Audit Log's existing DISCOUNT_APPLIED_HIGH/Warning
    // entry, so there's still an after-the-fact record, just no longer a
    // gate at the till.
    const highDiscountLines: Array<{ productId: number; productName: string; discountAmount: number; effectivePct: number }> = [];
    const lineResults: Array<{
      productId: number;
      quantity: number;
      unitPrice: number;
      unitCostSnapshot: number;
      lineSubtotal: number;
      discountType: 'NONE' | 'FIXED' | 'PERCENT';
      discountValue: number;
      discountAmount: number;
      lineTotal: number;
      discountReason: string | null;
      discountApprovedBy: number | null;
    }> = [];

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      if (!(item.quantity > 0)) {
        throw new HttpError(400, 'QUANTITY_MUST_BE_POSITIVE', undefined, { productId: item.productId });
      }

      // Row lock — held until COMMIT/ROLLBACK, serializing any other sale
      // touching this same product.
      const product = await productsRepo.findProductByIdForUpdate(item.productId, client);
      if (!product) {
        throw new HttpError(404, 'PRODUCT_NOT_FOUND', undefined, { productId: item.productId });
      }
      if (product.active_price === null) {
        // BR-27: no approved price => not sellable.
        throw new HttpError(422, 'PRODUCT_HAS_NO_APPROVED_PRICE', undefined, { productId: item.productId });
      }

      // Re-validated HERE, at commit time, under the row lock — not just
      // when the item was added to the cart client-side. This is the
      // check that BR-05/BR-06/Section 17 depend on.
      const currentStock = await stockMovementsRepo.getCurrentStock(product.id, client);
      if (currentStock < item.quantity) {
        throw new HttpError(409, 'INSUFFICIENT_STOCK', undefined, {
          productId: item.productId,
          available: currentStock,
          requested: item.quantity,
        });
      }

      const unitPrice = Number(product.active_price);
      const lineSubtotal = unitPrice * item.quantity;

      let discountType: 'NONE' | 'FIXED' | 'PERCENT' = 'NONE';
      let discountValue = 0;
      let discountAmount = 0;
      let discountReason: string | null = null;
      let discountApprovedBy: number | null = null;

      if (item.discount && item.discount.value > 0) {
        // BR-31 relaxed (CLAUDE.md #66) — a reason is no longer required; if
        // the cashier types one anyway it's still saved, same as before.
        discountType = item.discount.type;
        discountValue = item.discount.value;
        discountReason = item.discount.reason && item.discount.reason.trim() ? item.discount.reason.trim() : null;

        discountAmount =
          discountType === 'FIXED' ? discountValue : lineSubtotal * (discountValue / 100); // BR-30

        if (discountAmount > lineSubtotal) {
          throw new HttpError(400, 'DISCOUNT_EXCEEDS_LINE_TOTAL', undefined, { productId: item.productId });
        }

        // BR-32 relaxed (CLAUDE.md #66) — above the global limit no longer
        // blocks on an owner PIN; the sale completes either way, and this
        // line is just flagged for the warning + audit entry below.
        const effectivePct = lineSubtotal > 0 ? (discountAmount / lineSubtotal) * 100 : 0;
        if (effectivePct > maxPct) {
          highDiscountLines.push({ productId: product.id, productName: product.name, discountAmount, effectivePct });
        }
      }

      const unitCostSnapshot = await salesRepo.getLatestUnitCost(product.id, client);
      const lineTotal = lineSubtotal - discountAmount;

      subtotal += lineSubtotal;
      totalDiscount += discountAmount;

      lineResults.push({
        productId: product.id,
        quantity: item.quantity,
        unitPrice,
        unitCostSnapshot,
        lineSubtotal,
        discountType,
        discountValue,
        discountAmount,
        lineTotal,
        discountReason,
        discountApprovedBy,
      });
    }

    const total = subtotal - totalDiscount;

    // BR-04, redefined for credit sales (2026-09-12, CLAUDE.md #50): a sale
    // is still COMPLETED — and stock still leaves — the instant it's rung
    // up, either way; that part never changes. What used to require the
    // tendered amount to COVER the total now only requires it to be
    // POSITIVE ("no sale with no payment," the owner's own rule) — a deposit
    // smaller than the total is allowed, leaving the sale PARTIAL with a
    // real balance owed, collected later via POST /sales/:id/payments.
    // `amountCollected` is capped at `total`: if the customer tenders MORE
    // than the total in cash, the excess is change handed back, not a
    // payment the shop keeps — exactly how the pre-credit-sales code always
    // recorded `payments.amount = total` regardless of what was tendered.
    // "Give on Credit" (2026-09-25, owner's request, migration 021) — a
    // deliberate second gate alongside BR-04 above, not a relaxation of
    // it: TZS 0 collected right now is allowed ONLY through this explicit
    // path, which requires a real linked customer (customerId — a typed
    // walk-in name is not enough, since there'd be nobody to actually
    // chase for the debt) and an agreed due date. Every other sale — any
    // paymentAmount that isn't exactly 0 — still goes through the original
    // BR-04 check unchanged.
    const isCreditSale = input.paymentAmount === 0;
    if (isCreditSale) {
      if (!input.customerId) {
        throw new HttpError(400, 'CREDIT_SALE_REQUIRES_CUSTOMER', undefined, { total });
      }
      if (!input.dueDate) {
        throw new HttpError(400, 'CREDIT_SALE_REQUIRES_DUE_DATE', undefined, { total });
      }
    } else if (!(input.paymentAmount > 0)) {
      throw new HttpError(400, 'PAYMENT_AMOUNT_MUST_BE_POSITIVE', undefined, { total });
    }
    const amountCollected = Math.min(input.paymentAmount, total);
    const paymentStatus: 'PAID' | 'PARTIAL' = amountCollected >= total - 0.01 ? 'PAID' : 'PARTIAL';
    const saleDate = resolveSaleDate(input.saleDate);
    // A due date can accompany any PARTIAL sale, not only a TZS-0 credit
    // sale — but it's REQUIRED for one (checked above).
    const dueDate = input.dueDate?.trim() || null;

    let sale;
    try {
      sale = await salesRepo.insertSale(
        {
          invoiceNumber: await nextInvoiceNumber(client),
          subtotal,
          totalDiscount,
          total,
          servedBy: input.servedBy.id,
          customerName: input.customerName?.trim() || null,
          customerPhone: input.customerPhone?.trim() || null,
          customerAddress: input.customerAddress?.trim() || null,
          customerId: input.customerId ?? null,
          paymentStatus,
          saleDate,
          dueDate,
        },
        client
      );
    } catch (err) {
      // invoice_number is UNIQUE — with a sequential per-year number this is
      // now a real (if rare) possibility under concurrency: two sales
      // completing at nearly the same instant can both count the same
      // "next" number. NOTE this used to be "retried" in a loop on the same
      // client/transaction — that retry never actually worked, since a
      // failed statement leaves a Postgres transaction in an aborted state
      // (25P02) until ROLLBACK, so every query after the first failure
      // (including the "retry") was doomed regardless of whether a second
      // real collision occurred. Fixed the same way Purchases' equivalent
      // collision (#20) is handled: surface a clean, recoverable error and
      // let the whole request be resubmitted as a fresh transaction, rather
      // than retrying inside this now-poisoned one.
      if (isUniqueViolation(err, 'invoice_number')) {
        throw new HttpError(409, 'INVOICE_NUMBER_COLLISION');
      }
      throw err;
    }

    for (const line of lineResults) {
      await salesRepo.insertSaleItem({ saleId: sale.id, ...line }, client);
      await stockMovementsRepo.insertStockMovement(
        {
          productId: line.productId,
          movementType: 'SALE',
          quantity: -line.quantity,
          referenceType: 'sale',
          referenceId: sale.id,
          createdBy: input.servedBy.id,
        },
        client
      );
    }

    await salesRepo.insertPayment({ saleId: sale.id, amount: amountCollected, method: input.paymentMethod }, client);

    await writeAuditLog(
      {
        userId: input.servedBy.id,
        action: 'SALE_COMPLETED',
        entityType: 'sale',
        entityId: sale.id,
        details: {
          invoiceNumber: sale.invoice_number,
          total,
          itemCount: lineResults.length,
          paymentMethod: input.paymentMethod,
          paymentStatus,
          amountCollected,
          balanceDue: Math.max(0, total - amountCollected),
          // "Give on Credit" + backdating (2026-09-25) — visible on the
          // Audit Log so "who gave this out on credit, and was it entered
          // backdated" is answerable without opening the sale itself.
          isCreditSale,
          dueDate,
          backdated: !!input.saleDate,
        },
      },
      client
    );

    // One DISCOUNT_APPLIED_HIGH entry per line over the shop's limit
    // (CLAUDE.md #43, kept firing after #66 removed the owner-PIN gate) — the
    // Audit Log page's "Warning" status is reserved for exactly this action,
    // since every other logged action is, by construction, one that already
    // succeeded. This is now the only after-the-fact record of an over-limit
    // discount, so it fires unconditionally rather than only once a PIN had
    // already been verified.
    for (const line of highDiscountLines) {
      await writeAuditLog(
        {
          userId: input.servedBy.id,
          action: 'DISCOUNT_APPLIED_HIGH',
          entityType: 'sale',
          entityId: sale.id,
          details: {
            invoiceNumber: sale.invoice_number,
            productId: line.productId,
            productName: line.productName,
            discountAmount: line.discountAmount,
            effectivePct: Math.round(line.effectivePct * 10) / 10,
            maxPct,
          },
        },
        client
      );
    }

    const savedSale = await salesRepo.findSaleById(sale.id, client);
    // Surfaced to the frontend as a non-blocking warning toast, not a modal
    // that stops the sale (CLAUDE.md #66) — "high" only in the sense of
    // exceeding the configured limit; the sale has already gone through.
    return {
      ...savedSale,
      highDiscountWarnings: highDiscountLines.map((line) => ({
        productName: line.productName,
        effectivePct: Math.round(line.effectivePct * 10) / 10,
        maxPct,
      })),
    };
  });
}

/**
 * Invoice print tracking (2026-09-12, CLAUDE.md #47) — set the first time a
 * sale's receipt is actually printed, from either the POS "Sale Complete"
 * modal or Sales History's own print button. Idempotent: printed_at only
 * ever records the FIRST print, never overwritten by printing again later.
 * Deliberately doesn't touch `status` — a sale is fully COMPLETED and PAID
 * the moment it's rung up either way (BR-04); this only tracks the shop's
 * own paperwork step.
 */
export async function markSalePrinted(id: number, requester: AuthenticatedUser) {
  const sale = await salesRepo.findSaleById(id);
  if (!sale) {
    throw new HttpError(404, 'SALE_NOT_FOUND');
  }
  assertCanTouchSale(sale, requester);
  return salesRepo.markPrinted(id);
}

/**
 * Top up a PARTIAL sale's remaining balance (2026-09-12, CLAUDE.md #50) —
 * "mzigo unatoka sasa, malipo yanakuja baadaye" (goods leave now, payment
 * comes later): the deposit collected at completeSale time may not cover
 * the total, and the rest is collected in one or more follow-up payments
 * here, possibly by a different method than the original deposit (e.g. cash
 * now, the balance by bank transfer next week). Access mirrors every other
 * per-sale action in this file (assertCanTouchSale) — a non-owner may only
 * record a payment against a sale they personally served.
 */
export async function recordPayment(
  saleId: number,
  input: { amount: number; method: PaymentMethod },
  requester: AuthenticatedUser
) {
  if (!(input.amount > 0)) {
    throw new HttpError(400, 'PAYMENT_AMOUNT_MUST_BE_POSITIVE');
  }
  return withTransaction(async (client) => {
    const sale = await salesRepo.findSaleByIdForUpdate(saleId, client);
    if (!sale) throw new HttpError(404, 'SALE_NOT_FOUND');
    assertCanTouchSale(sale, requester);
    if (sale.status === 'VOIDED') {
      throw new HttpError(409, 'SALE_VOIDED');
    }

    const amountPaid = await salesRepo.getAmountPaid(saleId, client);
    const balanceDue = Number(sale.total) - amountPaid;
    if (input.amount > balanceDue + 0.01) {
      throw new HttpError(400, 'PAYMENT_EXCEEDS_BALANCE', undefined, { balanceDue });
    }

    await salesRepo.insertPayment({ saleId, amount: input.amount, method: input.method }, client);
    const newAmountPaid = amountPaid + input.amount;
    const newStatus: 'PAID' | 'PARTIAL' = newAmountPaid >= Number(sale.total) - 0.01 ? 'PAID' : 'PARTIAL';
    await salesRepo.updateSalePaymentStatus(saleId, newStatus, client);

    await writeAuditLog(
      {
        userId: requester.id,
        action: 'PAYMENT_RECORDED',
        entityType: 'sale',
        entityId: saleId,
        details: {
          invoiceNumber: sale.invoice_number,
          amount: input.amount,
          method: input.method,
          newBalanceDue: Math.max(0, Number(sale.total) - newAmountPaid),
          newStatus,
        },
      },
      client
    );

    return salesRepo.findSaleById(saleId, client);
  });
}

export async function getSaleById(id: number, requester: AuthenticatedUser) {
  const sale = await salesRepo.findSaleById(id);
  if (!sale) {
    throw new HttpError(404, 'SALE_NOT_FOUND');
  }
  assertCanTouchSale(sale, requester);
  return sale;
}

// Shared by getSaleById above and the Edit/edit-request flow below
// (2026-09-11, Change Approval Center, CLAUDE.md #35) — a non-owner may
// only view or edit a sale they personally served, same restriction either
// way; there's no separate "can view but not edit" tier.
function assertCanTouchSale(sale: { served_by: number }, requester: AuthenticatedUser) {
  if (requester.role !== 'owner' && sale.served_by !== requester.id) {
    throw new HttpError(403, 'FORBIDDEN');
  }
}

export function listSales(
  filters: {
    date?: string;
    from?: string;
    to?: string;
    servedBy?: number;
    status?: 'COMPLETED' | 'VOIDED';
    productId?: number;
    search?: string;
  },
  requester: AuthenticatedUser
) {
  return salesRepo.listSales({
    ...filters,
    ownerView: requester.role === 'owner',
    requesterId: requester.id,
  });
}

/**
 * "vs previous period" for the Sales History stat cards (2026-09-11,
 * CLAUDE.md #34) — a real comparison against the immediately preceding
 * range of the same length (e.g. a Sep 1–11 selection compares against
 * Aug 21–31), generalizing the this-month-vs-last-month pattern already
 * used on Suppliers (CLAUDE.md #30) to an arbitrary date range. When there's
 * no activity at all in the previous period, the change is `null` (a real
 * "nothing to compare against"), never a fabricated 0% or ±∞.
 *
 * Gross profit is cost-derived, so per BR-24 (and the same isOwner gating
 * already used on Products/Inventory) it's only included in the result for
 * an owner requester — a non-owner never receives `grossProfit` at all,
 * rather than receiving it and being trusted not to look.
 */
export async function getSalesStats(
  filters: { from: string; to: string; servedBy?: number },
  requester: AuthenticatedUser
) {
  const ownerView = requester.role === 'owner';
  const scope = { servedBy: filters.servedBy, ownerView, requesterId: requester.id };

  const current = await salesRepo.getSalesAggregate({ from: filters.from, to: filters.to, ...scope });
  const { prevFrom, prevTo } = previousPeriodRange(filters.from, filters.to);
  const previous = await salesRepo.getSalesAggregate({ from: prevFrom, to: prevTo, ...scope });

  const totalSales = Number(current.total_sales);
  const transactionCount = Number(current.transaction_count);
  const itemsSold = Number(current.items_sold);

  const result: {
    totalSales: number;
    transactionCount: number;
    itemsSold: number;
    totalSalesChangePct: number | null;
    transactionCountChangePct: number | null;
    itemsSoldChangePct: number | null;
    grossProfit?: number;
    grossProfitChangePct?: number | null;
  } = {
    totalSales,
    transactionCount,
    itemsSold,
    totalSalesChangePct: pctChange(totalSales, Number(previous.total_sales)),
    transactionCountChangePct: pctChange(transactionCount, Number(previous.transaction_count)),
    itemsSoldChangePct: pctChange(itemsSold, Number(previous.items_sold)),
  };

  if (ownerView) {
    const grossProfit = Number(current.gross_profit);
    result.grossProfit = grossProfit;
    result.grossProfitChangePct = pctChange(grossProfit, Number(previous.gross_profit));
  }

  return result;
}

/**
 * Void: reverses stock via VOID_REVERSAL movements (never deletes the sale —
 * CLAUDE.md rule #6 / BR-11/BR-12) and records who/why. Only an owner may
 * void (BR-13), enforced by route middleware.
 */
export async function voidSale(saleId: number, reason: string, voidedBy: AuthenticatedUser) {
  if (!reason || !reason.trim()) {
    throw new HttpError(400, 'VOID_REASON_REQUIRED');
  }

  return withTransaction(async (client) => {
    const sale = await salesRepo.findSaleByIdForUpdate(saleId, client);
    if (!sale) {
      throw new HttpError(404, 'SALE_NOT_FOUND');
    }
    if (sale.status === 'VOIDED') {
      throw new HttpError(409, 'SALE_ALREADY_VOIDED');
    }

    const items = await salesRepo.getSaleItems(saleId, client);
    const sortedItems = [...items].sort((a, b) => a.product_id - b.product_id);

    for (const item of sortedItems) {
      await productsRepo.findProductByIdForUpdate(item.product_id, client); // lock, consistent ordering
      await stockMovementsRepo.insertStockMovement(
        {
          productId: item.product_id,
          movementType: 'VOID_REVERSAL',
          quantity: item.quantity, // positive — reverses the earlier negative SALE movement
          referenceType: 'sale',
          referenceId: saleId,
          createdBy: voidedBy.id,
        },
        client
      );
    }

    const updated = await salesRepo.voidSaleRow(saleId, voidedBy.id, reason.trim(), client);
    await writeAuditLog(
      {
        userId: voidedBy.id,
        action: 'SALE_VOIDED',
        entityType: 'sale',
        entityId: saleId,
        details: { reason: reason.trim(), invoiceNumber: sale.invoice_number },
      },
      client
    );

    return salesRepo.findSaleById(saleId, client) ?? updated;
  });
}

// ---------------------------------------------------------------------------
// Change Approval Center — editing an already-completed sale (2026-09-11,
// CLAUDE.md #35). Two independent halves, per the owner's own framing:
//   - Non-financial fields (customer name/phone/notes) save immediately —
//     updateSaleDetails below.
//   - Financial fields (an existing line's quantity/unit price/discount)
//     never change the sale directly — they always go through an approval
//     request (requestSaleEdit), auto-approved immediately if the owner is
//     the one submitting it (mirrors price proposals / purchase edit
//     requests), otherwise PENDING until the owner reviews it.
// Deliberately NOT supported (confirmed with the owner): changing which
// product a line refers to, and adding or removing a line entirely — both
// still mean voiding the sale and re-entering it correctly, same as the
// Purchases correction workflow already treats an equivalent mistake.
// Total and payment amount are never independent inputs — they're always
// recomputed from the line items, exactly like at the point of sale.
// ---------------------------------------------------------------------------

export async function updateSaleDetails(
  saleId: number,
  patch: { customerName?: string | null; customerPhone?: string | null; notes?: string | null },
  requester: AuthenticatedUser
) {
  return withTransaction(async (client) => {
    const sale = await salesRepo.findSaleByIdForUpdate(saleId, client);
    if (!sale) throw new HttpError(404, 'SALE_NOT_FOUND');
    assertCanTouchSale(sale, requester);
    if (sale.status === 'VOIDED') {
      throw new HttpError(409, 'SALE_VOIDED'); // a voided sale is a dead record — no further edits
    }

    const updated = await salesRepo.updateSaleHeader(
      saleId,
      {
        customerName: patch.customerName !== undefined ? patch.customerName?.trim() || null : undefined,
        customerPhone: patch.customerPhone !== undefined ? patch.customerPhone?.trim() || null : undefined,
        notes: patch.notes !== undefined ? patch.notes?.trim() || null : undefined,
      },
      client
    );
    await writeAuditLog(
      { userId: requester.id, action: 'SALE_DETAILS_UPDATED', entityType: 'sale', entityId: saleId, details: patch },
      client
    );
    return salesRepo.findSaleById(saleId, client) ?? updated;
  });
}

/**
 * Recomputes one line's money fields from a proposed patch — shared by
 * requestSaleEdit (to reject an invalid submission immediately, before it's
 * even stored) and applySaleEdit (to actually apply it, whether that's the
 * owner's immediate auto-apply or a later approval). Same discount rules
 * completeSale enforces (BR-30; BR-31's reason requirement was removed,
 * CLAUDE.md #66) — this path never enforced BR-32's global max-discount-%
 * check to begin with, since every edit here already goes through the
 * owner's own review before anything changes, which is a stronger check
 * than a PIN ever was.
 */
function computePatchedLine(patch: ProposedSaleItemPatch) {
  if (!(patch.quantity > 0)) {
    throw new HttpError(400, 'QUANTITY_MUST_BE_POSITIVE', undefined, { saleItemId: patch.saleItemId });
  }
  if (!(patch.unitPrice >= 0)) {
    throw new HttpError(400, 'UNIT_PRICE_MUST_BE_NON_NEGATIVE', undefined, { saleItemId: patch.saleItemId });
  }
  const lineSubtotal = patch.unitPrice * patch.quantity;
  let discountAmount = 0;
  if (patch.discountType !== 'NONE' && patch.discountValue > 0) {
    discountAmount = patch.discountType === 'FIXED' ? patch.discountValue : lineSubtotal * (patch.discountValue / 100); // BR-30
    if (discountAmount > lineSubtotal) {
      throw new HttpError(400, 'DISCOUNT_EXCEEDS_LINE_TOTAL', undefined, { saleItemId: patch.saleItemId });
    }
  }
  return { lineSubtotal, discountAmount, lineTotal: lineSubtotal - discountAmount };
}

async function applySaleEdit(saleId: number, items: ProposedSaleItemPatch[], actingUserId: number, client: PoolClient) {
  const currentItems = await salesRepo.getSaleItemsForUpdate(saleId, client);
  const patchMap = new Map(items.map((i) => [i.saleItemId, i]));

  // Guard every quantity INCREASE against insufficient stock before changing
  // anything — the mirror image of Purchases' "would this decrease make
  // stock negative" guard, since more units sold means more stock consumed,
  // not less. A decrease always just gives stock back, so it's never
  // blocked here.
  for (const it of currentItems) {
    const patch = patchMap.get(it.id);
    if (!patch) continue;
    const delta = patch.quantity - it.quantity;
    if (delta > 0) {
      const currentStock = await stockMovementsRepo.getCurrentStock(it.product_id, client);
      if (currentStock < delta) {
        throw new HttpError(409, 'EDIT_WOULD_EXCEED_AVAILABLE_STOCK', undefined, {
          productId: it.product_id,
          currentStock,
          requestedIncrease: delta,
        });
      }
    }
  }

  let subtotal = 0;
  let totalDiscount = 0;
  for (const it of currentItems) {
    const patch = patchMap.get(it.id);
    if (!patch) {
      // Untouched line — still contributes to the sale's recomputed totals.
      subtotal += Number(it.line_subtotal);
      totalDiscount += Number(it.discount_amount);
      continue;
    }

    const { lineSubtotal, discountAmount, lineTotal } = computePatchedLine(patch);
    await salesRepo.updateSaleItem(
      it.id,
      {
        quantity: patch.quantity,
        unitPrice: patch.unitPrice,
        lineSubtotal,
        discountType: patch.discountType,
        discountValue: patch.discountValue,
        discountAmount,
        lineTotal,
        discountReason: patch.discountReason,
      },
      client
    );
    subtotal += lineSubtotal;
    totalDiscount += discountAmount;

    const delta = patch.quantity - it.quantity;
    if (delta !== 0) {
      await stockMovementsRepo.insertStockMovement(
        {
          productId: it.product_id,
          movementType: 'ADJUSTMENT',
          quantity: -delta, // selling MORE (+delta) consumes MORE stock (-)
          referenceType: 'sale_edit',
          referenceId: saleId,
          createdBy: actingUserId,
        },
        client
      );
    }
  }

  const total = subtotal - totalDiscount;
  await salesRepo.updateSaleTotals(saleId, { subtotal, totalDiscount, total }, client);
  // Payment amount always mirrors total (CLAUDE.md #35) — not an
  // independent field, so it's kept in sync here rather than left stale.
  await salesRepo.updatePaymentAmountForSale(saleId, total, client);
}

export async function requestSaleEdit(input: {
  saleId: number;
  items: ProposedSaleItemPatch[];
  reason?: string;
  requester: AuthenticatedUser;
}) {
  const isOwner = input.requester.role === 'owner';
  if (!isOwner && !(input.reason && input.reason.trim())) {
    throw new HttpError(400, 'REASON_REQUIRED');
  }
  if (input.items.length === 0) {
    throw new HttpError(400, 'NOTHING_TO_CHANGE');
  }

  return withTransaction(async (client) => {
    const sale = await salesRepo.findSaleByIdForUpdate(input.saleId, client);
    if (!sale) throw new HttpError(404, 'SALE_NOT_FOUND');
    assertCanTouchSale(sale, input.requester);
    if (sale.status === 'VOIDED') {
      throw new HttpError(409, 'SALE_VOIDED');
    }

    const existingItems: Array<{ id: number }> = await salesRepo.getSaleItemsForUpdate(input.saleId, client);
    const itemIds = new Set(existingItems.map((i) => i.id));
    for (const patch of input.items) {
      if (!itemIds.has(patch.saleItemId)) throw new HttpError(400, 'ITEM_NOT_ON_THIS_SALE');
      // Validated up front so an invalid request is rejected immediately
      // rather than stored as PENDING and only failing later at approval.
      computePatchedLine(patch);
    }

    if (isOwner) {
      const editRequest = await saleEditRequestsRepo.insertEditRequest(
        {
          saleId: input.saleId,
          proposedItems: input.items,
          reason: input.reason?.trim() || null,
          requestedBy: input.requester.id,
          status: 'APPROVED',
          reviewedBy: input.requester.id,
          reviewedAt: new Date(),
        },
        client
      );
      await applySaleEdit(input.saleId, input.items, input.requester.id, client);
      await writeAuditLog(
        {
          userId: input.requester.id,
          action: 'SALE_EDITED',
          entityType: 'sale',
          entityId: input.saleId,
          details: { editRequestId: editRequest.id, autoApproved: true },
        },
        client
      );
      return { editRequest, sale: await salesRepo.findSaleById(input.saleId, client) };
    }

    const existingPending = await saleEditRequestsRepo.findPendingForSale(input.saleId, client);
    if (existingPending) {
      throw new HttpError(409, 'PENDING_EDIT_ALREADY_EXISTS');
    }

    const editRequest = await saleEditRequestsRepo.insertEditRequest(
      {
        saleId: input.saleId,
        proposedItems: input.items,
        reason: input.reason!.trim(),
        requestedBy: input.requester.id,
        status: 'PENDING',
      },
      client
    );
    await writeAuditLog(
      {
        userId: input.requester.id,
        action: 'SALE_EDIT_REQUESTED',
        entityType: 'sale',
        entityId: input.saleId,
        details: { editRequestId: editRequest.id, reason: input.reason },
      },
      client
    );
    // Unlike the owner's own edit above, nothing has changed yet — the
    // returned `sale` is still exactly what it was before this request.
    return { editRequest, sale };
  });
}

// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — the new
// approval-review UI wants a headline "old total → new total" for the
// financial-impact preview, not just the itemized per-line diff. Computed
// here (real math, the same BR-30/BR-31 rules `applySaleEdit` itself uses),
// never a value the client invents. A request whose sale or items can no
// longer be read (deleted test data, a stale patch) just gets `preview:
// null` — the itemized diff still renders without it.
export async function listSaleEditRequests(status?: string) {
  const requests = await saleEditRequestsRepo.listEditRequests(status);
  return Promise.all(
    requests.map(async (req: any) => {
      let preview: { oldTotal: string; newTotal: number } | null = null;
      try {
        const sale = await salesRepo.findSaleById(req.sale_id);
        if (sale) {
          const patchMap = new Map(req.proposed_items.map((p: ProposedSaleItemPatch) => [p.saleItemId, p]));
          let newTotal = 0;
          for (const item of sale.items) {
            const patch = patchMap.get(item.id) as ProposedSaleItemPatch | undefined;
            newTotal += patch ? computePatchedLine(patch).lineTotal : Number(item.line_total);
          }
          preview = { oldTotal: sale.total, newTotal };
        }
      } catch {
        // Non-fatal — see comment above.
      }
      return { ...req, preview };
    })
  );
}

export async function approveSaleEdit(editRequestId: number, owner: AuthenticatedUser, notes?: string) {
  return withTransaction(async (client) => {
    const editRequest = await saleEditRequestsRepo.findByIdForUpdate(editRequestId, client);
    if (!editRequest) throw new HttpError(404, 'EDIT_REQUEST_NOT_FOUND');
    if (editRequest.status !== 'PENDING') throw new HttpError(409, 'EDIT_REQUEST_ALREADY_REVIEWED');

    await applySaleEdit(editRequest.sale_id, editRequest.proposed_items, owner.id, client);
    const reviewed = await saleEditRequestsRepo.reviewEditRequest(editRequestId, 'APPROVED', owner.id, notes ?? null, client);
    await writeAuditLog(
      {
        userId: owner.id,
        action: 'SALE_EDIT_APPROVED',
        entityType: 'sale',
        entityId: editRequest.sale_id,
        details: { editRequestId },
      },
      client
    );
    return { editRequest: reviewed, sale: await salesRepo.findSaleById(editRequest.sale_id, client) };
  });
}

export async function rejectSaleEdit(editRequestId: number, owner: AuthenticatedUser, notes?: string) {
  return withTransaction(async (client) => {
    const editRequest = await saleEditRequestsRepo.findByIdForUpdate(editRequestId, client);
    if (!editRequest) throw new HttpError(404, 'EDIT_REQUEST_NOT_FOUND');
    if (editRequest.status !== 'PENDING') throw new HttpError(409, 'EDIT_REQUEST_ALREADY_REVIEWED');

    const reviewed = await saleEditRequestsRepo.reviewEditRequest(editRequestId, 'REJECTED', owner.id, notes ?? null, client);
    await writeAuditLog(
      {
        userId: owner.id,
        action: 'SALE_EDIT_REJECTED',
        entityType: 'sale',
        entityId: editRequest.sale_id,
        details: { editRequestId },
      },
      client
    );
    return reviewed;
  });
}
