import { pool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { HttpError } from '../middleware/errorHandler';
import * as quotationsRepo from '../db/quotationsRepo';
import * as productsRepo from '../db/productsRepo';
import * as customersRepo from '../db/customersRepo';
import { getBusinessSettings } from '../db/businessSettingsRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

export interface QuotationItemLineInput {
  productId: number;
  quantity: number;
  unitPrice?: number; // defaults to the product's current active_price if omitted
  discountPct?: number;
}

export interface CreateQuotationLineInput {
  customerId?: number | null;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  validUntil?: string | null; // YYYY-MM-DD; defaults to today + business_settings.quotation_validity_days
  reference?: string | null;
  notes?: string | null;
  items: QuotationItemLineInput[];
}

function isUniqueViolation(err: unknown, column: string): boolean {
  const pgErr = err as { code?: string; constraint?: string; detail?: string } | null;
  return !!pgErr && pgErr.code === '23505' && (pgErr.constraint?.includes(column) || pgErr.detail?.includes(column)) === true;
}

export async function previewNextQuotationNumber(): Promise<string> {
  return quotationsRepo.nextQuotationNumber(pool);
}

/**
 * Ship To items are always picked from the product catalog (the owner's
 * choice — see CLAUDE.md #49, not free-text): every line needs a real
 * productId. unit_price defaults to the product's current active_price but
 * can be overridden (a quotation is often a negotiated price, unlike a
 * completed sale where the price always comes straight from the catalog).
 */
export async function createQuotation(input: CreateQuotationLineInput, actor: AuthenticatedUser) {
  if (!input.customerName || !input.customerName.trim()) {
    throw new HttpError(400, 'CUSTOMER_NAME_REQUIRED');
  }
  if (!input.items || input.items.length === 0) {
    throw new HttpError(400, 'AT_LEAST_ONE_ITEM_REQUIRED');
  }
  for (const line of input.items) {
    if (!line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new HttpError(400, 'INVALID_QUOTATION_ITEM');
    }
    if (line.discountPct !== undefined && (line.discountPct < 0 || line.discountPct > 100)) {
      throw new HttpError(400, 'DISCOUNT_PCT_OUT_OF_RANGE');
    }
  }

  let customer = null;
  if (input.customerId) {
    customer = await customersRepo.findCustomerById(input.customerId);
    if (!customer) {
      throw new HttpError(404, 'CUSTOMER_NOT_FOUND');
    }
  }

  const settings = await getBusinessSettings();
  // VAT removed from Quotations entirely (2026-09-25, owner's request —
  // this revisits an incomplete instruction from 2026-09-12/CLAUDE.md #51,
  // "ondoa VAT na swift pia", which only removed SWIFT at the time). Always
  // 0 regardless of business_settings.vat_rate_pct, which is no longer
  // surfaced in Settings either. The column stays on `quotations` (no
  // migration) so historical quotations that DID carry real VAT keep their
  // original stored numbers — this only stops charging/showing it on new
  // ones.
  const vatRatePct = 0;

  const resolvedItems: quotationsRepo.QuotationItemInput[] = [];
  let subtotal = 0;
  let totalDiscount = 0;

  for (const line of input.items) {
    const product = await productsRepo.findProductById(line.productId);
    if (!product) {
      throw new HttpError(404, 'PRODUCT_NOT_FOUND');
    }
    const unitPrice = line.unitPrice !== undefined ? Number(line.unitPrice) : Number(product.active_price ?? 0);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new HttpError(400, 'UNIT_PRICE_MUST_BE_NON_NEGATIVE');
    }
    const discountPct = line.discountPct ?? 0;
    const lineSubtotal = unitPrice * line.quantity;
    const lineTotal = lineSubtotal * (1 - discountPct / 100);

    subtotal += lineSubtotal;
    totalDiscount += lineSubtotal - lineTotal;

    resolvedItems.push({
      productId: product.id,
      description: product.name,
      unit: product.unit,
      quantity: line.quantity,
      unitPrice,
      discountPct,
      lineTotal,
    });
  }

  const netSubtotal = subtotal - totalDiscount;
  const vatAmount = netSubtotal * (vatRatePct / 100);
  const total = netSubtotal + vatAmount;

  const validUntil =
    input.validUntil ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() + Number(settings.quotation_validity_days ?? 14));
      return d.toISOString().slice(0, 10);
    })();

  // A genuine race on the numbering count (two quotations created at the
  // same instant) is rare on a single shop's traffic, but handled the same
  // way sales/purchases do: retry once with a freshly counted number rather
  // than surface a confusing 500.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const quotation = await withTransaction(async (client) => {
        const quotationNumber = await quotationsRepo.nextQuotationNumber(client);
        return quotationsRepo.insertQuotation(
          {
            quotationNumber,
            customerId: customer?.id ?? null,
            customerName: input.customerName.trim(),
            customerPhone: input.customerPhone?.trim() || customer?.phone || null,
            customerAddress: input.customerAddress?.trim() || customer?.address || null,
            validUntil,
            reference: input.reference?.trim() || null,
            subtotal,
            totalDiscount,
            vatRatePct,
            vatAmount,
            total,
            notes: input.notes?.trim() || null,
            createdBy: actor.id,
            items: resolvedItems,
          },
          client
        );
      });

      await writeAuditLog({
        userId: actor.id,
        action: 'QUOTATION_CREATED',
        entityType: 'quotation',
        entityId: quotation.id,
        details: { quotationNumber: quotation.quotation_number, customerName: quotation.customer_name, total },
      });

      return quotationsRepo.findQuotationById(quotation.id);
    } catch (err) {
      if (isUniqueViolation(err, 'quotation_number') && attempt === 0) {
        continue;
      }
      throw err;
    }
  }
  throw new HttpError(409, 'QUOTATION_NUMBER_COLLISION');
}

export function listQuotations() {
  return quotationsRepo.listQuotations();
}

export async function getQuotation(id: number) {
  const quotation = await quotationsRepo.findQuotationById(id);
  if (!quotation) {
    throw new HttpError(404, 'QUOTATION_NOT_FOUND');
  }
  return quotation;
}

const SETTABLE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;

export async function updateQuotationStatus(id: number, status: string, actor: AuthenticatedUser) {
  const quotation = await quotationsRepo.findQuotationById(id);
  if (!quotation) {
    throw new HttpError(404, 'QUOTATION_NOT_FOUND');
  }
  if (quotation.status === 'CONVERTED') {
    throw new HttpError(400, 'QUOTATION_ALREADY_CONVERTED');
  }
  if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, 'INVALID_QUOTATION_STATUS');
  }
  const updated = await quotationsRepo.updateQuotationStatus(id, status);
  await writeAuditLog({
    userId: actor.id,
    action: 'QUOTATION_STATUS_CHANGED',
    entityType: 'quotation',
    entityId: id,
    details: { quotationNumber: updated.quotation_number, status },
  });
  return updated;
}

/**
 * "Convert to Sale" (CLAUDE.md #49) — called after the POS has already
 * completed a real sale (pre-filled from this quotation's items, see
 * PosPage.tsx). This endpoint does no stock/pricing work itself; it only
 * links the two records and closes out the quotation.
 */
export async function convertQuotationToSale(id: number, saleId: number, actor: AuthenticatedUser) {
  const quotation = await quotationsRepo.findQuotationById(id);
  if (!quotation) {
    throw new HttpError(404, 'QUOTATION_NOT_FOUND');
  }
  if (quotation.status === 'CONVERTED') {
    throw new HttpError(400, 'QUOTATION_ALREADY_CONVERTED');
  }
  const updated = await quotationsRepo.markQuotationConverted(id, saleId);
  await writeAuditLog({
    userId: actor.id,
    action: 'QUOTATION_CONVERTED',
    entityType: 'quotation',
    entityId: id,
    details: { quotationNumber: updated.quotation_number, saleId },
  });
  return updated;
}
