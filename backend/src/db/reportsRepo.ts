import { pool } from './pool';

// All reports exclude VOIDED sales and use post-discount totals (BR-33) unless noted.

export async function salesReport(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT sa.id, sa.invoice_number, sa.sale_date, sa.subtotal, sa.total_discount, sa.total,
            sa.status, sa.served_by, u.name AS served_by_name, sa.customer_name
     FROM sales sa
     JOIN users u ON u.id = sa.served_by
     WHERE sa.sale_date::date BETWEEN $1 AND $2
     ORDER BY sa.sale_date DESC`,
    [from, to]
  );

  return { sales: rows, summary: await salesTotals(from, to) };
}

/**
 * Reports "Sales" tab redesign (2026-09-12, CLAUDE.md #41) — split out of
 * `salesReport`'s own totals subquery so it can be called twice (current
 * period + the immediately preceding period of equal length, via
 * `utils/period.ts`) without also re-fetching the full per-sale row list
 * both times.
 */
export async function salesTotals(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS transaction_count,
        COALESCE(SUM(total) FILTER (WHERE status = 'COMPLETED'), 0) AS total_revenue,
        COALESCE(SUM(total_discount) FILTER (WHERE status = 'COMPLETED'), 0) AS total_discount,
        COUNT(*) FILTER (WHERE status = 'VOIDED') AS voided_count
     FROM sales
     WHERE sale_date::date BETWEEN $1 AND $2`,
    [from, to]
  );
  return rows[0];
}

// One row per calendar day in range that had ANY sale (completed or
// voided) — days with zero activity aren't returned at all; the service
// fills those gaps so every stat card's sparkline covers the full range
// without lying by omission on a quiet day. All 4 metrics come from this
// one query so every stat card's sparkline is real daily data, not a
// decorative line with nothing behind it.
export async function salesDailySeries(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT sale_date::date AS date,
            COALESCE(SUM(total) FILTER (WHERE status = 'COMPLETED'), 0) AS revenue,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS transactions,
            COALESCE(SUM(total_discount) FILTER (WHERE status = 'COMPLETED'), 0) AS discount,
            COUNT(*) FILTER (WHERE status = 'VOIDED')::int AS voided
     FROM sales
     WHERE sale_date::date BETWEEN $1 AND $2
     GROUP BY sale_date::date
     ORDER BY sale_date::date ASC`,
    [from, to]
  );
  return rows;
}

// LEFT JOIN categories — a product with no category still counts, grouped
// under NULL/"Uncategorized" rather than silently dropped from the total.
export async function revenueByCategory(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT COALESCE(c.name, 'Uncategorized') AS category_name,
            SUM(si.quantity) AS quantity_sold,
            SUM(si.line_total) AS revenue
     FROM sale_items si
     JOIN sales sa ON sa.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE sa.sale_date::date BETWEEN $1 AND $2 AND sa.status = 'COMPLETED'
     GROUP BY category_name
     ORDER BY revenue DESC`,
    [from, to]
  );
  return rows;
}

// Replaces the mockup's "Sales by Payment Method" donut (confirmed with the
// owner, CLAUDE.md #41) — every payment in this system is CASH by a DB
// constraint (`payments.method CHECK (method = 'CASH')`, MVP scope), so a
// payment-method breakdown would be either meaningless (100% Cash) or
// fabricated. "Revenue by Staff Member" is real, already-tracked data.
export async function revenueByStaff(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT sa.served_by AS user_id, u.name AS user_name,
            COUNT(*)::int AS transaction_count,
            COALESCE(SUM(sa.total), 0) AS revenue
     FROM sales sa
     JOIN users u ON u.id = sa.served_by
     WHERE sa.sale_date::date BETWEEN $1 AND $2 AND sa.status = 'COMPLETED'
     GROUP BY sa.served_by, u.name
     ORDER BY revenue DESC`,
    [from, to]
  );
  return rows;
}

export async function productSalesReport(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT si.product_id, p.name AS product_name, p.unit,
            SUM(si.quantity) AS quantity_sold,
            SUM(si.line_total) AS revenue,
            SUM(si.unit_cost_snapshot * si.quantity) AS cost,
            SUM(si.line_total - (si.unit_cost_snapshot * si.quantity)) AS gross_profit
     FROM sale_items si
     JOIN sales sa ON sa.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     WHERE sa.sale_date::date BETWEEN $1 AND $2 AND sa.status = 'COMPLETED'
     GROUP BY si.product_id, p.name, p.unit
     ORDER BY revenue DESC`,
    [from, to]
  );
  return rows;
}

export async function discountsReport(from: string, to: string, userId?: number) {
  const conditions = [`sa.sale_date::date BETWEEN $1 AND $2`, `sa.status = 'COMPLETED'`, `si.discount_amount > 0`];
  const values: unknown[] = [from, to];
  if (userId) {
    values.push(userId);
    conditions.push(`sa.served_by = $${values.length}`);
  }

  const { rows: byUser } = await pool.query(
    `SELECT sa.served_by AS user_id, u.name AS user_name,
            COUNT(*) AS discount_count,
            COALESCE(SUM(si.discount_amount), 0) AS total_discount
     FROM sale_items si
     JOIN sales sa ON sa.id = si.sale_id
     JOIN users u ON u.id = sa.served_by
     WHERE ${conditions.join(' AND ')}
     GROUP BY sa.served_by, u.name
     ORDER BY total_discount DESC`,
    values
  );

  const { rows: byReason } = await pool.query(
    `SELECT COALESCE(NULLIF(si.discount_reason, ''), '(no reason given)') AS reason,
            COUNT(*) AS discount_count,
            COALESCE(SUM(si.discount_amount), 0) AS total_discount
     FROM sale_items si
     JOIN sales sa ON sa.id = si.sale_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY reason
     ORDER BY total_discount DESC`,
    values
  );

  return { byUser, byReason };
}

export async function usersActivityReport(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name, u.role,
            COUNT(sa.id) FILTER (WHERE sa.status = 'COMPLETED') AS transaction_count,
            COALESCE(SUM(sa.total) FILTER (WHERE sa.status = 'COMPLETED'), 0) AS total_revenue,
            COALESCE(SUM(sa.total_discount) FILTER (WHERE sa.status = 'COMPLETED'), 0) AS total_discount,
            COUNT(sa.id) FILTER (WHERE sa.status = 'VOIDED') AS voided_count
     FROM users u
     LEFT JOIN sales sa ON sa.served_by = u.id AND sa.sale_date::date BETWEEN $1 AND $2
     WHERE u.role = 'sales'
     GROUP BY u.id, u.name, u.role
     ORDER BY total_revenue DESC`,
    [from, to]
  );
  return rows;
}

/**
 * "Purchase Costs" report (2026-09-12, CLAUDE.md #40) — the owner asked how
 * to see the total overhead purchasing added this month/period in one
 * place. `purchases.additional_costs` is already the per-purchase total of
 * `purchase_additional_cost_lines` (see that table's own comment: "never a
 * second total to add on top of it"), so summing it directly here is
 * correct and needs no join to the cost-lines table for the headline
 * figure — the cost-lines join below is only for the by-label breakdown.
 *
 * Deliberately excludes each purchase's own goods subtotal (`total_cost -
 * additional_costs`) from the "combined overhead" total — the owner
 * confirmed this report is about the *extra* cost of purchasing, not the
 * cost of the goods themselves (which is already visible via Purchases/
 * Suppliers). `subtotal`/`total_cost` are still returned per row for
 * context, just not folded into the overhead figures.
 */
export async function purchaseCostsReport(from: string, to: string) {
  const { rows: purchases } = await pool.query(
    `SELECT pu.id, pu.reference_number, pu.purchase_date, s.name AS supplier_name,
            pu.total_cost, pu.additional_costs, (pu.total_cost - pu.additional_costs) AS goods_subtotal
     FROM purchases pu
     JOIN suppliers s ON s.id = pu.supplier_id
     WHERE pu.purchase_date BETWEEN $1 AND $2
     ORDER BY pu.purchase_date DESC, pu.id DESC`,
    [from, to]
  );

  const { rows: totalsRows } = await pool.query(
    `SELECT
        COUNT(*) AS purchase_count,
        COALESCE(SUM(total_cost - additional_costs), 0) AS total_goods_value,
        COALESCE(SUM(additional_costs), 0) AS total_additional_costs
     FROM purchases
     WHERE purchase_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const { rows: costLinesByLabel } = await pool.query(
    `SELECT cl.label, COALESCE(SUM(cl.amount), 0) AS total
     FROM purchase_additional_cost_lines cl
     JOIN purchases pu ON pu.id = cl.purchase_id
     WHERE pu.purchase_date BETWEEN $1 AND $2
     GROUP BY cl.label
     ORDER BY total DESC`,
    [from, to]
  );

  const { rows: perPurchaseExpenses } = await pool.query(
    `SELECT e.*, u.name AS created_by_name
     FROM expenses e
     JOIN users u ON u.id = e.created_by
     WHERE e.expense_type = 'PER_PURCHASE' AND e.expense_date BETWEEN $1 AND $2
     ORDER BY e.expense_date DESC, e.id DESC`,
    [from, to]
  );

  const { rows: perPurchaseByCategory } = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE expense_type = 'PER_PURCHASE' AND expense_date BETWEEN $1 AND $2
     GROUP BY category
     ORDER BY total DESC`,
    [from, to]
  );

  return {
    purchases,
    summary: totalsRows[0],
    costLinesByLabel,
    perPurchaseExpenses,
    perPurchaseByCategory,
  };
}

export async function todaySummary(date: string) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS transaction_count,
        COALESCE(SUM(total) FILTER (WHERE status = 'COMPLETED'), 0) AS total_sales,
        COALESCE(SUM(subtotal - total) FILTER (WHERE status = 'COMPLETED'), 0) AS total_discount
     FROM sales
     WHERE sale_date::date = $1`,
    [date]
  );

  const { rows: profitRows } = await pool.query(
    `SELECT COALESCE(SUM(si.line_total - (si.unit_cost_snapshot * si.quantity)), 0) AS gross_profit
     FROM sale_items si
     JOIN sales sa ON sa.id = si.sale_id
     WHERE sa.sale_date::date = $1 AND sa.status = 'COMPLETED'`,
    [date]
  );

  const { rows: topProducts } = await pool.query(
    `SELECT si.product_id, p.name AS product_name, SUM(si.quantity) AS quantity_sold, SUM(si.line_total) AS revenue
     FROM sale_items si
     JOIN sales sa ON sa.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     WHERE sa.sale_date::date = $1 AND sa.status = 'COMPLETED'
     GROUP BY si.product_id, p.name
     ORDER BY quantity_sold DESC
     LIMIT 5`,
    [date]
  );

  return {
    transactionCount: Number(rows[0].transaction_count),
    totalSales: Number(rows[0].total_sales),
    totalDiscount: Number(rows[0].total_discount),
    grossProfit: Number(profitRows[0].gross_profit),
    topProducts,
  };
}
