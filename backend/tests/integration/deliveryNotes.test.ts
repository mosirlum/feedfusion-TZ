import {
  createDeliveryNote,
  getDeliveryNote,
  listDeliveryNotes,
  updateDeliveryNoteStatus,
  linkDeliveryNoteToSale,
  deleteDeliveryNote,
  previewNextDeliveryNoteNumber,
} from '../../src/services/deliveryNotes.service';
import { completeSale } from '../../src/services/sales.service';
import { getCurrentStock } from '../../src/db/stockMovementsRepo';
import { pool } from '../../src/db/pool';
import {
  resetDatabase,
  insertTestUser,
  insertBusinessSettings,
  insertTestProduct,
  insertStockMovement,
  closePool,
} from '../testHelpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDatabase();
  await insertBusinessSettings({ defaultMaxDiscountPct: 5 });
});

async function stockOf(productId: number): Promise<number> {
  const client = await pool.connect();
  try {
    return await getCurrentStock(productId, client);
  } finally {
    client.release();
  }
}

async function seed() {
  const owner = await insertTestUser({ email: 'owner@feedfusion.co.tz', password: 'Owner@12345', role: 'owner' });
  const product = await insertTestProduct({ name: 'KPC-30', unit: 'kg', activePrice: 2000 });
  await insertStockMovement({ productId: product.id, movementType: 'PURCHASE', quantity: 100, balanceAfter: 100, createdBy: owner.id });
  const actor = { id: owner.id, role: 'owner' } as any;
  return { owner, product, actor };
}

describe('Delivery Notes — standalone, no stock effect', () => {
  it('creates a delivery note without any sale, numbers it DN-YYYY-0001, and leaves stock untouched', async () => {
    const { product, actor } = await seed();
    const note = await createDeliveryNote(
      { customerName: 'Mzee Juma', deliveryAddress: 'Kibaha', items: [{ productId: product.id, quantity: 30 }] },
      actor
    );
    expect(note!.delivery_note_number).toMatch(/^DN-\d{4}-0001$/);
    expect(note!.status).toBe('ISSUED');
    expect(note!.linked_sale_id).toBeNull();
    expect(note!.items).toHaveLength(1);
    expect(Number(note!.items[0].quantity)).toBe(30);
    expect(note!.items[0].description).toBe('KPC-30');
    // Stock is NOT reduced by a delivery note.
    expect(await stockOf(product.id)).toBe(100);
  });

  it('numbers consecutively and the preview shows the next one', async () => {
    const { product, actor } = await seed();
    await createDeliveryNote({ customerName: 'A', items: [{ productId: product.id, quantity: 1 }] }, actor);
    const second = await createDeliveryNote({ customerName: 'B', items: [{ productId: product.id, quantity: 1 }] }, actor);
    expect(second!.delivery_note_number).toMatch(/-0002$/);
    expect(await previewNextDeliveryNoteNumber()).toMatch(/-0003$/);
    expect(await listDeliveryNotes()).toHaveLength(2);
  });

  it('validates the customer name, items, quantity and date', async () => {
    const { product, actor } = await seed();
    await expect(createDeliveryNote({ customerName: '  ', items: [{ productId: product.id, quantity: 1 }] }, actor)).rejects.toMatchObject({ message: 'CUSTOMER_NAME_REQUIRED' });
    await expect(createDeliveryNote({ customerName: 'A', items: [] }, actor)).rejects.toMatchObject({ message: 'AT_LEAST_ONE_ITEM_REQUIRED' });
    await expect(createDeliveryNote({ customerName: 'A', items: [{ productId: product.id, quantity: 0 }] }, actor)).rejects.toMatchObject({ message: 'INVALID_DELIVERY_NOTE_ITEM' });
    await expect(createDeliveryNote({ customerName: 'A', deliveryDate: '16/10/2026', items: [{ productId: product.id, quantity: 1 }] }, actor)).rejects.toMatchObject({ message: 'INVALID_DELIVERY_DATE' });
    await expect(createDeliveryNote({ customerName: 'A', items: [{ productId: 99999, quantity: 1 }] }, actor)).rejects.toMatchObject({ message: 'PRODUCT_NOT_FOUND' });
    expect(await listDeliveryNotes()).toHaveLength(0);
  });

  it('can be linked to a sale later by invoice number, and unlinked', async () => {
    const { product, actor } = await seed();
    const note = await createDeliveryNote({ customerName: 'Mzee Juma', items: [{ productId: product.id, quantity: 10 }] }, actor);
    const sale: any = await completeSale({
      items: [{ productId: product.id, quantity: 10 }],
      paymentMethod: 'CASH',
      paymentAmount: 20000,
      servedBy: { id: actor.id, role: 'owner' },
    });
    // The real sale reduces stock exactly once — not the delivery note.
    expect(await stockOf(product.id)).toBe(90);

    const linked = await linkDeliveryNoteToSale(note!.id, sale.invoice_number, actor);
    expect(linked!.linked_sale_id).toBe(sale.id);
    expect(linked!.linked_invoice_number).toBe(sale.invoice_number);

    const unlinked = await linkDeliveryNoteToSale(note!.id, '', actor);
    expect(unlinked!.linked_sale_id).toBeNull();
    expect(await stockOf(product.id)).toBe(90);
  });

  it('rejects an unknown invoice number, at creation and when linking', async () => {
    const { product, actor } = await seed();
    await expect(createDeliveryNote({ customerName: 'A', invoiceNumber: 'INV-0000-0000', items: [{ productId: product.id, quantity: 1 }] }, actor)).rejects.toMatchObject({ message: 'LINKED_SALE_NOT_FOUND' });
    const note = await createDeliveryNote({ customerName: 'A', items: [{ productId: product.id, quantity: 1 }] }, actor);
    await expect(linkDeliveryNoteToSale(note!.id, 'INV-0000-0000', actor)).rejects.toMatchObject({ message: 'LINKED_SALE_NOT_FOUND' });
  });

  it('status moves ISSUED → DELIVERED → ISSUED, and a cancelled note is locked', async () => {
    const { product, actor } = await seed();
    const note = await createDeliveryNote({ customerName: 'A', items: [{ productId: product.id, quantity: 1 }] }, actor);
    expect((await updateDeliveryNoteStatus(note!.id, 'DELIVERED', actor))!.status).toBe('DELIVERED');
    expect((await updateDeliveryNoteStatus(note!.id, 'ISSUED', actor))!.status).toBe('ISSUED');
    await expect(updateDeliveryNoteStatus(note!.id, 'BOGUS', actor)).rejects.toMatchObject({ message: 'INVALID_DELIVERY_NOTE_STATUS' });
    await updateDeliveryNoteStatus(note!.id, 'CANCELLED', actor);
    await expect(updateDeliveryNoteStatus(note!.id, 'DELIVERED', actor)).rejects.toMatchObject({ message: 'DELIVERY_NOTE_ALREADY_CANCELLED' });
    await expect(linkDeliveryNoteToSale(note!.id, 'x', actor)).rejects.toMatchObject({ message: 'DELIVERY_NOTE_ALREADY_CANCELLED' });
    // Cancelling does not move stock either.
    expect(await stockOf(product.id)).toBe(100);
  });

  it('writes audit entries and 404s for a missing note', async () => {
    const { product, actor } = await seed();
    const note = await createDeliveryNote({ customerName: 'A', items: [{ productId: product.id, quantity: 1 }] }, actor);
    await updateDeliveryNoteStatus(note!.id, 'DELIVERED', actor);
    const { rows } = await pool.query(`SELECT action FROM audit_logs WHERE entity_type = 'delivery_note' ORDER BY id`);
    expect(rows.map((r) => r.action)).toEqual(['DELIVERY_NOTE_CREATED', 'DELIVERY_NOTE_STATUS_CHANGED']);
    await expect(getDeliveryNote(99999)).rejects.toMatchObject({ message: 'DELIVERY_NOTE_NOT_FOUND' });
  });

  it('delete: only a cancelled note can be deleted, it disappears with its items, is audited, and stock is untouched', async () => {
    const { product, actor } = await seed();
    const note = await createDeliveryNote({ customerName: 'Mzee Juma', items: [{ productId: product.id, quantity: 5 }] }, actor);

    // A live (ISSUED) note must be cancelled first.
    await expect(deleteDeliveryNote(note!.id, actor)).rejects.toMatchObject({ message: 'DELIVERY_NOTE_MUST_BE_CANCELLED_FIRST' });
    expect(await listDeliveryNotes()).toHaveLength(1);

    await updateDeliveryNoteStatus(note!.id, 'CANCELLED', actor);
    const result = await deleteDeliveryNote(note!.id, actor);
    expect(result).toEqual({ deleted: true, deliveryNoteNumber: note!.delivery_note_number });

    expect(await listDeliveryNotes()).toHaveLength(0);
    await expect(getDeliveryNote(note!.id)).rejects.toMatchObject({ message: 'DELIVERY_NOTE_NOT_FOUND' });
    const items = await pool.query('SELECT 1 FROM delivery_note_items WHERE delivery_note_id = $1', [note!.id]);
    expect(items.rowCount).toBe(0);

    const { rows } = await pool.query(`SELECT action, details FROM audit_logs WHERE entity_type = 'delivery_note' ORDER BY id`);
    expect(rows.map((r) => r.action)).toEqual(['DELIVERY_NOTE_CREATED', 'DELIVERY_NOTE_STATUS_CHANGED', 'DELIVERY_NOTE_DELETED']);
    expect(rows[2].details).toMatchObject({ deliveryNoteNumber: note!.delivery_note_number, customerName: 'Mzee Juma', itemCount: 1 });

    expect(await stockOf(product.id)).toBe(100);
    await expect(deleteDeliveryNote(note!.id, actor)).rejects.toMatchObject({ message: 'DELIVERY_NOTE_NOT_FOUND' });
  });

  it('delete leaves a linked sale completely untouched', async () => {
    const { product, actor } = await seed();
    const sale: any = await completeSale({
      items: [{ productId: product.id, quantity: 4 }],
      paymentMethod: 'CASH',
      paymentAmount: 8000,
      servedBy: { id: actor.id, role: 'owner' },
    });
    const note = await createDeliveryNote({ customerName: 'A', invoiceNumber: sale.invoice_number, items: [{ productId: product.id, quantity: 4 }] }, actor);
    await updateDeliveryNoteStatus(note!.id, 'CANCELLED', actor);
    await deleteDeliveryNote(note!.id, actor);
    const { rows } = await pool.query('SELECT status FROM sales WHERE id = $1', [sale.id]);
    expect(rows[0].status).toBe('COMPLETED');
    expect(await stockOf(product.id)).toBe(96);
  });
});
