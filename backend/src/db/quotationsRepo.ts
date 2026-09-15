import { PoolClient } from 'pg';
import { pool } from './pool';

// New Quotations module (2026-09-12, CLAUDE.md #49). Numbering mirrors
// sales.service.ts's nextInvoiceNumber() exactly: a simple per-year count,
// not a dedicated sequence — good enough for a single shop, and a genuine
// race is caught by quotation_number's UNIQUE constraint and surfaced as a
// clean, recoverable error (see quotations.service.ts).
export async function nextQuotationNumber(queryable: PoolClient | typeof pool): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await queryable.query(
    'SELECT COUNT(*)::int AS count FROM quotations WHERE quotation_number LIKE $1',
    [`QTN-${year}-%`]
  );
  const next = rows[0].count + 1;
  return `QTN-${year}-${String(next).padStart(4, '0')}`;
}

export interface QuotationItemInput {
  productId: number | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
}

export interface CreateQuotationInput {
  quotationNumber: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  validUntil: string; // YYYY-MM-DD
  reference: string | null;
  subtotal: number;
  totalDiscount: number;
  vatRatePct: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  createdBy: number;
  items: QuotationItemInput[];
}

export async function insertQuotation(input: CreateQuotationInput, client: PoolClient) {
  const { rows } = await client.query(
    `INSERT INTO quotations
       (quotation_number, customer_id, customer_name, customer_phone, customer_address,
        valid_until, reference, subtotal, total_discount, vat_rate_pct, vat_amount, total, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.quotationNumber,
      input.customerId,
      input.customerName,
      input.customerPhone,
      input.customerAddress,
      input.validUntil,
      input.reference,
      input.subtotal,
      input.totalDiscount,
      input.vatRatePct,
      input.vatAmount,
      input.total,
      input.notes,
      input.createdBy,
    ]
  );
  const quotation = rows[0];

  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    await client.query(
      `INSERT INTO quotation_items
         (quotation_id, product_id, description, unit, quantity, unit_price, discount_pct, line_total, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [quotation.id, item.productId, item.description, item.unit, item.quantity, item.unitPrice, item.discountPct, item.lineTotal, i]
    );
  }

  return quotation;
}

export async function listQuotations() {
  const { rows } = await pool.query(
    `SELECT q.*, u.name AS created_by_name,
            (SELECT COUNT(*)::int FROM quotation_items qi WHERE qi.quotation_id = q.id) AS item_count
     FROM quotations q
     JOIN users u ON u.id = q.created_by
     ORDER BY q.created_at DESC`
  );
  return rows;
}

export async function findQuotationById(id: number) {
  const { rows } = await pool.query(
    `SELECT q.*, u.name AS created_by_name
     FROM quotations q
     JOIN users u ON u.id = q.created_by
     WHERE q.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order ASC, id ASC`,
    [id]
  );
  return { ...rows[0], items };
}

export async function updateQuotationStatus(id: number, status: string) {
  const { rows } = await pool.query(`UPDATE quotations SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
  return rows[0] ?? null;
}

export async function markQuotationConverted(id: number, saleId: number) {
  const { rows } = await pool.query(
    `UPDATE quotations SET status = 'CONVERTED', converted_sale_id = $1 WHERE id = $2 RETURNING *`,
    [saleId, id]
  );
  return rows[0] ?? null;
}
