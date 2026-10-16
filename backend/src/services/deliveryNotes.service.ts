import { pool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { HttpError } from '../middleware/errorHandler';
import * as deliveryNotesRepo from '../db/deliveryNotesRepo';
import * as productsRepo from '../db/productsRepo';
import * as customersRepo from '../db/customersRepo';
import { writeAuditLog } from '../db/auditRepo';
import { AuthenticatedUser } from '../types/auth';

// New Delivery Notes module (2026-10-16). A standalone document: it never
// reads or writes stock, prices or payments. Stock moves only when the real
// sale completes, exactly as before — see migration 022.

export interface DeliveryNoteItemLineInput {
  productId: number;
  quantity: number;
}

export interface CreateDeliveryNoteLineInput {
  customerId?: number | null;
  customerName: string;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryDate?: string | null; // YYYY-MM-DD, defaults to today
  driverName?: string | null;
  vehicleNumber?: string | null;
  reference?: string | null;
  notes?: string | null;
  invoiceNumber?: string | null; // optional link to an existing sale
  items: DeliveryNoteItemLineInput[];
}

function isUniqueViolation(err: unknown, column: string): boolean {
  const pgErr = err as { code?: string; constraint?: string; detail?: string } | null;
  return !!pgErr && pgErr.code === '23505' && (pgErr.constraint?.includes(column) || pgErr.detail?.includes(column)) === true;
}

async function resolveSaleId(invoiceNumber: string | null | undefined): Promise<number | null> {
  const trimmed = invoiceNumber?.trim();
  if (!trimmed) return null;
  const sale = await deliveryNotesRepo.findSaleByInvoiceNumber(trimmed);
  if (!sale) throw new HttpError(404, 'LINKED_SALE_NOT_FOUND');
  if (sale.status === 'VOIDED') throw new HttpError(400, 'LINKED_SALE_VOIDED');
  return sale.id;
}

export async function previewNextDeliveryNoteNumber(): Promise<string> {
  return deliveryNotesRepo.nextDeliveryNoteNumber(pool);
}

export async function createDeliveryNote(input: CreateDeliveryNoteLineInput, actor: AuthenticatedUser) {
  if (!input.customerName || !input.customerName.trim()) {
    throw new HttpError(400, 'CUSTOMER_NAME_REQUIRED');
  }
  if (!input.items || input.items.length === 0) {
    throw new HttpError(400, 'AT_LEAST_ONE_ITEM_REQUIRED');
  }
  for (const line of input.items) {
    if (!line.productId || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new HttpError(400, 'INVALID_DELIVERY_NOTE_ITEM');
    }
  }
  if (input.deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)) {
    throw new HttpError(400, 'INVALID_DELIVERY_DATE');
  }

  let customer = null;
  if (input.customerId) {
    customer = await customersRepo.findCustomerById(input.customerId);
    if (!customer) throw new HttpError(404, 'CUSTOMER_NOT_FOUND');
  }
  const linkedSaleId = await resolveSaleId(input.invoiceNumber);

  const resolvedItems: deliveryNotesRepo.DeliveryNoteItemInput[] = [];
  for (const line of input.items) {
    const product = await productsRepo.findProductById(line.productId);
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND');
    resolvedItems.push({
      productId: product.id,
      description: product.name,
      unit: product.unit,
      quantity: line.quantity,
    });
  }

  // Same retry-once-on-numbering-race pattern as quotations/sales.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const note = await withTransaction(async (client) => {
        const deliveryNoteNumber = await deliveryNotesRepo.nextDeliveryNoteNumber(client);
        return deliveryNotesRepo.insertDeliveryNote(
          {
            deliveryNoteNumber,
            customerId: customer?.id ?? null,
            customerName: input.customerName.trim(),
            customerPhone: input.customerPhone?.trim() || customer?.phone || null,
            deliveryAddress: input.deliveryAddress?.trim() || customer?.address || null,
            deliveryDate: input.deliveryDate || null,
            driverName: input.driverName?.trim() || null,
            vehicleNumber: input.vehicleNumber?.trim() || null,
            reference: input.reference?.trim() || null,
            notes: input.notes?.trim() || null,
            linkedSaleId,
            createdBy: actor.id,
            items: resolvedItems,
          },
          client
        );
      });

      await writeAuditLog({
        userId: actor.id,
        action: 'DELIVERY_NOTE_CREATED',
        entityType: 'delivery_note',
        entityId: note.id,
        details: { deliveryNoteNumber: note.delivery_note_number, customerName: note.customer_name, itemCount: resolvedItems.length },
      });

      return deliveryNotesRepo.findDeliveryNoteById(note.id);
    } catch (err) {
      if (isUniqueViolation(err, 'delivery_note_number') && attempt === 0) continue;
      throw err;
    }
  }
  throw new HttpError(409, 'DELIVERY_NOTE_NUMBER_COLLISION');
}

export function listDeliveryNotes() {
  return deliveryNotesRepo.listDeliveryNotes();
}

export async function getDeliveryNote(id: number) {
  const note = await deliveryNotesRepo.findDeliveryNoteById(id);
  if (!note) throw new HttpError(404, 'DELIVERY_NOTE_NOT_FOUND');
  return note;
}

const SETTABLE_STATUSES = ['ISSUED', 'DELIVERED', 'CANCELLED'] as const;

export async function updateDeliveryNoteStatus(id: number, status: string, actor: AuthenticatedUser) {
  const note = await deliveryNotesRepo.findDeliveryNoteById(id);
  if (!note) throw new HttpError(404, 'DELIVERY_NOTE_NOT_FOUND');
  if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) {
    throw new HttpError(400, 'INVALID_DELIVERY_NOTE_STATUS');
  }
  if (note.status === 'CANCELLED') {
    throw new HttpError(400, 'DELIVERY_NOTE_ALREADY_CANCELLED');
  }
  const updated = await deliveryNotesRepo.updateDeliveryNoteStatus(id, status);
  await writeAuditLog({
    userId: actor.id,
    action: 'DELIVERY_NOTE_STATUS_CHANGED',
    entityType: 'delivery_note',
    entityId: id,
    details: { deliveryNoteNumber: updated.delivery_note_number, from: note.status, status },
  });
  return deliveryNotesRepo.findDeliveryNoteById(id);
}

/** Link (or unlink with an empty invoiceNumber) the sale that later covers this delivery. */
export async function linkDeliveryNoteToSale(id: number, invoiceNumber: string | null | undefined, actor: AuthenticatedUser) {
  const note = await deliveryNotesRepo.findDeliveryNoteById(id);
  if (!note) throw new HttpError(404, 'DELIVERY_NOTE_NOT_FOUND');
  if (note.status === 'CANCELLED') throw new HttpError(400, 'DELIVERY_NOTE_ALREADY_CANCELLED');
  const saleId = await resolveSaleId(invoiceNumber);
  await deliveryNotesRepo.setLinkedSale(id, saleId);
  await writeAuditLog({
    userId: actor.id,
    action: 'DELIVERY_NOTE_LINKED',
    entityType: 'delivery_note',
    entityId: id,
    details: { deliveryNoteNumber: note.delivery_note_number, invoiceNumber: invoiceNumber?.trim() || null },
  });
  return deliveryNotesRepo.findDeliveryNoteById(id);
}
