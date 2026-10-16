import { PoolClient } from 'pg';
import { pool } from './pool';

// New Delivery Notes module (2026-10-16). Numbering mirrors
// quotationsRepo.nextQuotationNumber(): a per-year count, with a race caught
// by the UNIQUE constraint and retried once in the service.
export async function nextDeliveryNoteNumber(queryable: PoolClient | typeof pool): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await queryable.query(
    'SELECT COUNT(*)::int AS count FROM delivery_notes WHERE delivery_note_number LIKE $1',
    [`DN-${year}-%`]
  );
  return `DN-${year}-${String(rows[0].count + 1).padStart(4, '0')}`;
}

export interface DeliveryNoteItemInput {
  productId: number | null;
  description: string;
  unit: string | null;
  quantity: number;
}

export interface CreateDeliveryNoteInput {
  deliveryNoteNumber: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryDate: string | null; // YYYY-MM-DD; null → DB default (today)
  reference: string | null;
  notes: string | null;
  linkedSaleId: number | null;
  createdBy: number;
  items: DeliveryNoteItemInput[];
}

export async function insertDeliveryNote(input: CreateDeliveryNoteInput, client: PoolClient) {
  const { rows } = await client.query(
    `INSERT INTO delivery_notes
       (delivery_note_number, customer_id, customer_name, customer_phone, delivery_address,
        delivery_date, reference, notes, linked_sale_id, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10)
     RETURNING *`,
    [
      input.deliveryNoteNumber,
      input.customerId,
      input.customerName,
      input.customerPhone,
      input.deliveryAddress,
      input.deliveryDate,
      input.reference,
      input.notes,
      input.linkedSaleId,
      input.createdBy,
    ]
  );
  const note = rows[0];
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    await client.query(
      `INSERT INTO delivery_note_items (delivery_note_id, product_id, description, unit, quantity, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [note.id, item.productId, item.description, item.unit, item.quantity, i]
    );
  }
  return note;
}

export async function listDeliveryNotes() {
  const { rows } = await pool.query(
    `SELECT d.*, u.name AS created_by_name, s.invoice_number AS linked_invoice_number,
            (SELECT COUNT(*)::int FROM delivery_note_items di WHERE di.delivery_note_id = d.id) AS item_count
     FROM delivery_notes d
     JOIN users u ON u.id = d.created_by
     LEFT JOIN sales s ON s.id = d.linked_sale_id
     ORDER BY d.created_at DESC`
  );
  return rows;
}

export async function findDeliveryNoteById(id: number) {
  const { rows } = await pool.query(
    `SELECT d.*, u.name AS created_by_name, s.invoice_number AS linked_invoice_number
     FROM delivery_notes d
     JOIN users u ON u.id = d.created_by
     LEFT JOIN sales s ON s.id = d.linked_sale_id
     WHERE d.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT * FROM delivery_note_items WHERE delivery_note_id = $1 ORDER BY sort_order ASC, id ASC`,
    [id]
  );
  return { ...rows[0], items };
}

export async function updateDeliveryNoteStatus(id: number, status: string) {
  const { rows } = await pool.query(`UPDATE delivery_notes SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
  return rows[0] ?? null;
}

export async function deleteDeliveryNote(id: number) {
  // delivery_note_items go with it (ON DELETE CASCADE). Nothing else
  // references a delivery note, and it never touched stock.
  const { rowCount } = await pool.query(`DELETE FROM delivery_notes WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function setLinkedSale(id: number, saleId: number | null) {
  const { rows } = await pool.query(`UPDATE delivery_notes SET linked_sale_id = $1 WHERE id = $2 RETURNING *`, [saleId, id]);
  return rows[0] ?? null;
}

export async function findSaleByInvoiceNumber(invoiceNumber: string) {
  const { rows } = await pool.query(
    `SELECT id, invoice_number, status FROM sales WHERE invoice_number = $1`,
    [invoiceNumber]
  );
  return rows[0] ?? null;
}
