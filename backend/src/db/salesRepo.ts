import { PoolClient } from 'pg';
import { pool } from './pool';

export async function insertSale(
  input: {
    invoiceNumber: string;
    subtotal: number;
    totalDiscount: number;
    total: number;
    servedBy: number;
    customerName: string | null;
    // Credit sales (2026-09-12, CLAUDE.md #50) — customerPhone already
    // existed on `sales` (migration 012) but was never set at completion
    // time, only via the later PATCH /sales/:id edit; now captured up front
    // like customerAddress/customerId (new columns, migration 018).
    customerPhone: string | null;
    customerAddress: string | null;
    customerId: number | null;
    paymentStatus: 'PAID' | 'PARTIAL';
    // Backdated sale entry (2026-09-25, owner's request) — the cashier can
    // record a sale on a later real day than it actually happened
    // (Monday, for last Saturday's sales) and set the reporting-facing
    // date back to when it truly happened. This is ALWAYS set by the
    // service layer, never left to the DB's `DEFAULT now()` — either the
    // caller-supplied backdated moment, or "now" when no backdate was
    // requested — so the actual point-in-time the stock left (every
    // stock_movements row below still uses its own real `created_at`) is
    // never confused with this reporting date. See sales.service.ts
    // completeSale for the validation (never in the future) and the
    // combine-date-with-current-time-of-day logic.
    saleDate: Date;
    // "Give on Credit" due date (2026-09-25, migration 021) — required by
    // the service layer whenever this is a TZS-0 credit sale, optional
    // otherwise (a PARTIAL sale may or may not carry an agreed date).
    dueDate: string | null;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO sales
       (invoice_number, subtotal, total_discount, total, served_by, customer_name,
        customer_phone, customer_address, customer_id, payment_status, sale_date, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.invoiceNumber,
      input.subtotal,
      input.totalDiscount,
      input.total,
      input.servedBy,
      input.customerName,
      input.customerPhone,
      input.customerAddress,
      input.customerId,
      input.paymentStatus,
      input.saleDate,
      input.dueDate,
    ]
  );
  return rows[0];
}

export async function insertSaleItem(
  input: {
    saleId: number;
    productId: number;
    unitPrice: number;
    unitCostSnapshot: number;
    quantity: number;
    lineSubtotal: number;
    discountType: 'NONE' | 'FIXED' | 'PERCENT';
    discountValue: number;
    discountAmount: number;
    lineTotal: number;
    discountReason: string | null;
    discountApprovedBy: number | null;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO sale_items
       (sale_id, product_id, unit_price, unit_cost_snapshot, quantity, line_subtotal,
        discount_type, discount_value, discount_amount, line_total, discount_reason, discount_approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.saleId,
      input.productId,
      input.unitPrice,
      input.unitCostSnapshot,
      input.quantity,
      input.lineSubtotal,
      input.discountType,
      input.discountValue,
      input.discountAmount,
      input.lineTotal,
      input.discountReason,
      input.discountApprovedBy,
    ]
  );
  return rows[0];
}

// method now a real choice (2026-09-12, CLAUDE.md #50) — CASH/BANK_TRANSFER/
// MOBILE_MONEY, widened from the CASH-only original (see migration 018).
export async function insertPayment(
  input: { saleId: number; amount: number; method: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY' },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO payments (sale_id, amount, method) VALUES ($1, $2, $3) RETURNING *`,
    [input.saleId, input.amount, input.method]
  );
  return rows[0];
}

// amount_paid/balance_due are never stored — always the sum of this sale's
// payments rows vs. its total (2026-09-12, CLAUDE.md #50), same "derive,
// don't duplicate" principle as stock (rule #1). Computed here once the
// payments are already fetched, rather than a second query.
function withBalance(sale: any, payments: any[]) {
  const amountPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balanceDue = Math.max(0, Number(sale.total) - amountPaid);
  return { ...sale, amount_paid: amountPaid, balance_due: balanceDue };
}

async function attachItemsAndPayments(sale: any, runner: PoolClient | typeof pool) {
  const { rows: items } = await runner.query(
    `SELECT si.*, p.name AS product_name, p.unit
     FROM sale_items si JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id ASC`,
    [sale.id]
  );
  const { rows: payments } = await runner.query('SELECT * FROM payments WHERE sale_id = $1 ORDER BY created_at ASC', [
    sale.id,
  ]);
  return { ...withBalance(sale, payments), items, payments };
}

export async function findSaleById(id: number, client?: PoolClient) {
  const runner = client ?? pool;
  const { rows } = await runner.query(
    `SELECT sa.*, u.name AS served_by_name
     FROM sales sa JOIN users u ON u.id = sa.served_by
     WHERE sa.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  return attachItemsAndPayments(rows[0], runner);
}

export async function findSaleByIdForUpdate(id: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
}

// The "Edit" action's non-financial half (2026-09-11, Change Approval
// Center, CLAUDE.md #35) — customer_name/customer_phone/notes save
// immediately, no approval, since none of them touch money, stock, or a
// receipt's totals. Only the fields actually passed are changed.
export async function updateSaleHeader(
  id: number,
  patch: { customerName?: string | null; customerPhone?: string | null; notes?: string | null },
  client: PoolClient
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.customerName !== undefined) {
    values.push(patch.customerName);
    sets.push(`customer_name = $${values.length}`);
  }
  if (patch.customerPhone !== undefined) {
    values.push(patch.customerPhone);
    sets.push(`customer_phone = $${values.length}`);
  }
  if (patch.notes !== undefined) {
    values.push(patch.notes);
    sets.push(`notes = $${values.length}`);
  }
  if (sets.length === 0) {
    const { rows } = await client.query('SELECT * FROM sales WHERE id = $1', [id]);
    return rows[0];
  }
  values.push(id);
  const { rows } = await client.query(
    `UPDATE sales SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0];
}

// Locks every line on the sale for an edit-request's approval/auto-apply
// (2026-09-11, CLAUDE.md #35) — mirrors purchasesRepo.getPurchaseItemsForUpdate.
export async function getSaleItemsForUpdate(saleId: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id ASC FOR UPDATE', [
    saleId,
  ]);
  return rows;
}

export async function updateSaleItem(
  id: number,
  patch: {
    quantity: number;
    unitPrice: number;
    lineSubtotal: number;
    discountType: 'NONE' | 'FIXED' | 'PERCENT';
    discountValue: number;
    discountAmount: number;
    lineTotal: number;
    discountReason: string | null;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE sale_items
     SET quantity = $1, unit_price = $2, line_subtotal = $3, discount_type = $4,
         discount_value = $5, discount_amount = $6, line_total = $7, discount_reason = $8
     WHERE id = $9
     RETURNING *`,
    [
      patch.quantity,
      patch.unitPrice,
      patch.lineSubtotal,
      patch.discountType,
      patch.discountValue,
      patch.discountAmount,
      patch.lineTotal,
      patch.discountReason,
      id,
    ]
  );
  return rows[0];
}

export async function updateSaleTotals(
  id: number,
  totals: { subtotal: number; totalDiscount: number; total: number },
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE sales SET subtotal = $1, total_discount = $2, total = $3 WHERE id = $4 RETURNING *`,
    [totals.subtotal, totals.totalDiscount, totals.total, id]
  );
  return rows[0];
}

// Payment amount isn't an independently-editable field (CLAUDE.md #35) — it
// always mirrors the sale's total, exactly like at completeSale time
// (`insertPayment({ amount: total })`), so an approved edit that changes the
// total updates the one payment row to match rather than leaving it stale.
export async function updatePaymentAmountForSale(saleId: number, amount: number, client: PoolClient) {
  await client.query(`UPDATE payments SET amount = $1 WHERE sale_id = $2`, [amount, saleId]);
}

export async function getSaleItems(saleId: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [saleId]);
  return rows;
}

export async function voidSaleRow(
  id: number,
  voidedBy: number,
  reason: string,
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE sales SET status = 'VOIDED', voided_by = $1, voided_at = now(), void_reason = $2 WHERE id = $3 RETURNING *`,
    [voidedBy, reason, id]
  );
  return rows[0];
}

// 2026-09-11 (Sales History redesign, CLAUDE.md #34): `date` (single day)
// kept for backward compatibility, but `from`/`to` (inclusive date range) is
// what the redesigned page actually uses for its date-range picker. `search`
// matches invoice number, customer name, OR any product name on the sale
// (a real EXISTS join against sale_items/products, not client-side-only, so
// searching "search by ... product" in the page's placeholder is honest).
// `productId` filters to sales containing that product. `item_count` is a
// cheap per-row subquery (small per-sale row counts) so the table can show
// "N items" without a second round trip per row.
export async function listSales(filters: {
  date?: string;
  from?: string;
  to?: string;
  servedBy?: number;
  status?: 'COMPLETED' | 'VOIDED';
  productId?: number;
  search?: string;
  ownerView: boolean;
  requesterId: number;
}) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.date) {
    values.push(filters.date);
    conditions.push(`sa.sale_date::date = $${values.length}`);
  }
  if (filters.from) {
    values.push(filters.from);
    conditions.push(`sa.sale_date::date >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`sa.sale_date::date <= $${values.length}`);
  }
  if (filters.servedBy) {
    values.push(filters.servedBy);
    conditions.push(`sa.served_by = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`sa.status = $${values.length}`);
  }
  if (filters.productId) {
    values.push(filters.productId);
    conditions.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = sa.id AND si.product_id = $${values.length})`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    const idx = values.length;
    conditions.push(
      `(sa.invoice_number ILIKE $${idx} OR sa.customer_name ILIKE $${idx} OR EXISTS (
         SELECT 1 FROM sale_items si JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = sa.id AND p.name ILIKE $${idx}
       ))`
    );
  }
  if (!filters.ownerView) {
    values.push(filters.requesterId);
    conditions.push(`sa.served_by = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT sa.*, u.name AS served_by_name,
            (SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = sa.id) AS item_count,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.sale_id = sa.id) AS amount_paid,
            (SELECT method FROM payments p WHERE p.sale_id = sa.id ORDER BY p.created_at DESC LIMIT 1) AS last_payment_method,
            (SELECT COUNT(DISTINCT method)::int FROM payments p WHERE p.sale_id = sa.id) AS payment_method_count
     FROM sales sa JOIN users u ON u.id = sa.served_by
     ${where}
     ORDER BY sa.sale_date DESC
     LIMIT 500`,
    values
  );
  // balance_due alongside the per-row amount_paid subquery above (2026-09-12,
  // CLAUDE.md #50) — same derive-don't-store principle as findSaleById.
  return rows.map((r) => ({ ...r, balance_due: Math.max(0, Number(r.total) - Number(r.amount_paid)) }));
}

// Powers the Sales History stat cards (2026-09-11, CLAUDE.md #34). Excludes
// VOIDED sales from every figure — same real precedent as
// sumSalesTotalForDate above ("a voided sale never contributed cash"), so a
// reversed transaction can't inflate Total Sales/Items Sold/Profit. Profit
// (gross_profit) is always computed here — the service layer, not this
// query, decides whether to strip it before it reaches a non-owner (BR-24).
export async function getSalesAggregate(filters: {
  from: string;
  to: string;
  servedBy?: number;
  ownerView: boolean;
  requesterId: number;
}) {
  const conditions: string[] = [`sa.sale_date::date >= $1`, `sa.sale_date::date <= $2`, `sa.status = 'COMPLETED'`];
  const values: unknown[] = [filters.from, filters.to];

  if (filters.servedBy) {
    values.push(filters.servedBy);
    conditions.push(`sa.served_by = $${values.length}`);
  }
  if (!filters.ownerView) {
    values.push(filters.requesterId);
    conditions.push(`sa.served_by = $${values.length}`);
  }

  // Four scalar subqueries reusing the same $1.. params, rather than one
  // joined query — joining sale_items directly would multiply sa.total by
  // each sale's item count, double-counting Total Sales/Total Transactions.
  const where = conditions.join(' AND ');
  const { rows } = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(sa.total), 0) FROM sales sa WHERE ${where}) AS total_sales,
       (SELECT COUNT(*)::int FROM sales sa WHERE ${where}) AS transaction_count,
       (SELECT COALESCE(SUM(si.quantity), 0)
          FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE ${where}) AS items_sold,
       (SELECT COALESCE(SUM(si.line_total - si.unit_cost_snapshot * si.quantity), 0)
          FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE ${where}) AS gross_profit`,
    values
  );
  return rows[0];
}

// BR-33 / Section 20: expected CASH is the real cash actually received on a
// given date — not a sale's total, and not scoped by when the sale happened.
// Rewritten 2026-09-12 (CLAUDE.md #50, credit sales) for two reasons a plain
// sale-total-by-sale-date sum can no longer answer honestly:
//   1. A sale can now be PARTIAL — only the deposit actually collected that
//      day is real cash in the till, not the sale's full total.
//   2. A balance can be topped up later, on a different day and by a
//      different method (cash/bank/mobile) via POST /sales/:id/payments —
//      that later cash payment belongs in THAT day's count, not the
//      original sale date, and a bank/mobile top-up never counts as cash at
//      all (it never touches the physical till).
// `sa.status = 'COMPLETED'` keeps the existing rule intact: a voided sale's
// payments never count, exactly as before.
export async function sumCashReceivedForDate(date: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS total
     FROM payments p JOIN sales sa ON sa.id = p.sale_id
     WHERE p.created_at::date = $1 AND sa.status = 'COMPLETED' AND p.method = 'CASH'`,
    [date]
  );
  return Number(rows[0].total);
}

export async function sumCashReceivedForRange(from: string, to: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS total
     FROM payments p JOIN sales sa ON sa.id = p.sale_id
     WHERE p.created_at::date BETWEEN $1 AND $2 AND sa.status = 'COMPLETED' AND p.method = 'CASH'`,
    [from, to]
  );
  return Number(rows[0].total);
}

// Record an additional payment against an existing sale's balance
// (2026-09-12, CLAUDE.md #50) — topping up a PARTIAL sale later, possibly by
// a different method than the original deposit.
export async function getAmountPaid(saleId: number, client: PoolClient): Promise<number> {
  const { rows } = await client.query('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE sale_id = $1', [
    saleId,
  ]);
  return Number(rows[0].total);
}

export async function updateSalePaymentStatus(id: number, status: 'PAID' | 'PARTIAL', client: PoolClient) {
  const { rows } = await client.query(`UPDATE sales SET payment_status = $1 WHERE id = $2 RETURNING *`, [status, id]);
  return rows[0];
}

// Invoice print tracking (2026-09-12, CLAUDE.md #47) — idempotent: only ever
// sets printed_at the FIRST time (COALESCE keeps any existing value), so
// printing the same receipt again later never overwrites the original
// printed timestamp. Deliberately doesn't touch `status`.
export async function markPrinted(id: number, client?: PoolClient) {
  const runner = client ?? pool;
  const { rows } = await runner.query(
    `UPDATE sales SET printed_at = COALESCE(printed_at, now()) WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getLatestUnitCost(productId: number, client: PoolClient): Promise<number> {
  const { rows } = await client.query(
    `SELECT (pi.unit_cost + pi.allocated_additional_cost / NULLIF(pi.quantity, 0)) AS last_unit_cost
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     WHERE pi.product_id = $1
     ORDER BY pu.purchase_date DESC, pi.id DESC
     LIMIT 1`,
    [productId]
  );
  return rows[0]?.last_unit_cost !== undefined && rows[0]?.last_unit_cost !== null ? Number(rows[0].last_unit_cost) : 0;
}

// Outstanding Customer Debt (2026-09-19, CLAUDE.md #69 follow-up) — the
// Dashboard's "Total Sales" reflects the full invoiced amount of every
// COMPLETED sale regardless of how much cash actually came in (credit
// sales, CLAUDE.md #50), so a shop that's extended a lot of credit could
// look healthier on the Dashboard than it really is with cash still owed
// to it. This surfaces that gap: every COMPLETED sale still carrying a
// balance (payment_status = 'PARTIAL' and balance_due > 0 — PAID sales are
// never included, since by definition they owe nothing).
//
// Per-sale, not per-customer: `customer_id` (migration 016/018) is optional
// — a credit sale rung up for a walk-in customer often has only a
// customer_name typed in, no linked Customers record — so grouping by
// customer_id would silently miss those, and grouping by name/phone risks
// merging two different people who happen to share one. Listing each
// unresolved sale on its own is the honest, unambiguous option.
//
// Ordered oldest-first (sale_date ASC) — a judgment call, not spelled out
// anywhere in the docs: the oldest unpaid balance is usually the one most
// worth chasing first, but "largest balance first" is an equally
// defensible reading. Flagging this rather than silently picking one.
export async function getOutstandingBalances(): Promise<{
  totalOutstanding: number;
  debtorCount: number;
  overdueCount: number;
  topDebtors: Array<{
    id: number;
    invoice_number: string;
    sale_date: string;
    customer_name: string | null;
    customer_phone: string | null;
    total: number;
    amount_paid: number;
    balance_due: number;
    due_date: string | null;
    is_overdue: boolean;
  }>;
}> {
  const { rows } = await pool.query(
    `SELECT sa.id, sa.invoice_number, sa.sale_date, sa.customer_name, sa.customer_phone,
            sa.due_date,
            sa.total::float AS total,
            COALESCE(pay.paid, 0)::float AS amount_paid,
            (sa.total - COALESCE(pay.paid, 0))::float AS balance_due,
            -- Overdue (2026-09-25, migration 021) — never stored, derived
            -- the same way balance_due is: a due date was agreed and it's
            -- already in the past. Ordered overdue-first below so the
            -- "ila alert ifanye" ask actually surfaces on the dashboard
            -- rather than getting buried under sales with no due date yet.
            (sa.due_date IS NOT NULL AND sa.due_date < CURRENT_DATE) AS is_overdue
     FROM sales sa
     LEFT JOIN (SELECT sale_id, SUM(amount) AS paid FROM payments GROUP BY sale_id) pay
       ON pay.sale_id = sa.id
     WHERE sa.status = 'COMPLETED' AND sa.payment_status = 'PARTIAL'
       AND (sa.total - COALESCE(pay.paid, 0)) > 0
     ORDER BY (sa.due_date IS NOT NULL AND sa.due_date < CURRENT_DATE) DESC, sa.sale_date ASC`
  );

  const totalOutstanding = rows.reduce((sum, r) => sum + Number(r.balance_due), 0);
  const overdueCount = rows.filter((r) => r.is_overdue).length;
  return {
    totalOutstanding,
    debtorCount: rows.length,
    overdueCount,
    topDebtors: rows.slice(0, 10),
  };
}
