import { pool } from './pool';

/**
 * Read-only queries behind Business Growth's detail sections. No schema
 * changes: everything is derived from sales, sale_items, payments,
 * stock_movements and customers. VOIDED sales never count.
 */

export interface ProductVelocityRow {
  product_id: number;
  /** Total quantity sold in the window. */
  sold_qty: number;
  /** Most recent completed sale of this product, any date (null = never sold). */
  last_sold_at: string | null;
  /** First stock movement ever recorded — used to avoid flagging brand-new products. */
  first_movement_at: string | null;
}

export async function productVelocity(from: string, to: string): Promise<ProductVelocityRow[]> {
  const { rows } = await pool.query(
    `SELECT p.id AS product_id,
            COALESCE(w.sold_qty, 0)::float AS sold_qty,
            l.last_sold_at,
            m.first_movement_at
     FROM products p
     LEFT JOIN (
       SELECT si.product_id, SUM(si.quantity) AS sold_qty
       FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
       WHERE sa.status = 'COMPLETED' AND sa.sale_date::date BETWEEN $1 AND $2
       GROUP BY si.product_id
     ) w ON w.product_id = p.id
     LEFT JOIN (
       SELECT si.product_id, MAX(sa.sale_date) AS last_sold_at
       FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
       WHERE sa.status = 'COMPLETED'
       GROUP BY si.product_id
     ) l ON l.product_id = p.id
     LEFT JOIN (
       SELECT product_id, MIN(created_at) AS first_movement_at
       FROM stock_movements GROUP BY product_id
     ) m ON m.product_id = p.id`,
    [from, to]
  );
  return rows;
}

export interface TopCustomerRow {
  customer_key: string;
  customer_id: number | null;
  name: string;
  phone: string | null;
  sales_count: number;
  revenue: number;
}

/**
 * Best named customers by revenue in a window. Walk-in sales with no
 * customer name are excluded on purpose — they can't be followed up, and
 * lumping them into one "Walk-in" row would always top the list.
 */
export async function topCustomers(from: string, to: string, limit: number): Promise<TopCustomerRow[]> {
  const { rows } = await pool.query(
    `SELECT COALESCE(sa.customer_id::text, 'n:' || LOWER(TRIM(sa.customer_name))) AS customer_key,
            MAX(sa.customer_id) AS customer_id,
            MAX(COALESCE(c.name, sa.customer_name)) AS name,
            MAX(COALESCE(c.phone, sa.customer_phone)) AS phone,
            COUNT(*)::int AS sales_count,
            SUM(sa.total)::float AS revenue
     FROM sales sa
     LEFT JOIN customers c ON c.id = sa.customer_id
     WHERE sa.status = 'COMPLETED'
       AND sa.sale_date::date BETWEEN $1 AND $2
       AND (sa.customer_id IS NOT NULL OR NULLIF(TRIM(sa.customer_name), '') IS NOT NULL)
     GROUP BY 1
     ORDER BY revenue DESC
     LIMIT $3`,
    [from, to, limit]
  );
  return rows;
}

export interface CustomerDebtRow {
  customer_key: string;
  name: string;
  phone: string | null;
  invoices: number;
  balance_due: number;
  overdue_balance: number;
  /** Earliest due date among this customer's open invoices (null if none set). */
  oldest_due_date: string | null;
}

/** Open credit balances aggregated per customer, overdue-first. */
export async function customerDebts(limit: number): Promise<{ rows: CustomerDebtRow[]; totalOutstanding: number; debtorCount: number }> {
  const { rows } = await pool.query(
    `WITH open_sales AS (
       SELECT sa.id, sa.customer_id, sa.customer_name, sa.customer_phone, sa.due_date,
              (sa.total - COALESCE(pay.paid, 0))::float AS balance_due
       FROM sales sa
       LEFT JOIN (SELECT sale_id, SUM(amount) AS paid FROM payments GROUP BY sale_id) pay ON pay.sale_id = sa.id
       WHERE sa.status = 'COMPLETED' AND sa.payment_status = 'PARTIAL'
         AND (sa.total - COALESCE(pay.paid, 0)) > 0
     )
     SELECT COALESCE(o.customer_id::text, 'n:' || LOWER(TRIM(COALESCE(o.customer_name, '')))) AS customer_key,
            MAX(COALESCE(c.name, NULLIF(TRIM(o.customer_name), ''), 'Unnamed customer')) AS name,
            MAX(COALESCE(c.phone, o.customer_phone)) AS phone,
            COUNT(*)::int AS invoices,
            SUM(o.balance_due)::float AS balance_due,
            COALESCE(SUM(o.balance_due) FILTER (WHERE o.due_date IS NOT NULL AND o.due_date < CURRENT_DATE), 0)::float AS overdue_balance,
            MIN(o.due_date) AS oldest_due_date
     FROM open_sales o
     LEFT JOIN customers c ON c.id = o.customer_id
     GROUP BY 1
     ORDER BY overdue_balance DESC, balance_due DESC`
  );
  const totalOutstanding = rows.reduce((sum, r) => sum + Number(r.balance_due), 0);
  return { rows: rows.slice(0, limit), totalOutstanding, debtorCount: rows.length };
}

export interface RangeMetricsRow {
  revenue: number;
  sales_count: number;
  gross_profit: number;
  /** Distinct named customers (saved or typed-name) with a completed sale in the range. */
  customers_served: number;
  /** Of those, customers whose FIRST-EVER completed sale falls inside the range. */
  new_customers: number;
}

/**
 * Month-comparison building block (2026-10-26): one round trip for the sales
 * side of a date range. Same rules as the Reports/Growth queries — COMPLETED
 * sales only, `sale_date::date`, revenue = SUM(total), gross profit from the
 * sale_items cost snapshot, customers keyed exactly like `topCustomers`
 * (saved id, else normalised typed name; unnamed walk-ins are not counted).
 */
export async function rangeMetrics(from: string, to: string): Promise<RangeMetricsRow> {
  const { rows } = await pool.query(
    `WITH s AS (
       SELECT id, total, sale_date::date AS d,
              COALESCE(customer_id::text, 'n:' || LOWER(TRIM(customer_name))) AS ckey,
              (customer_id IS NOT NULL OR NULLIF(TRIM(customer_name), '') IS NOT NULL) AS named
       FROM sales
       WHERE status = 'COMPLETED'
     ),
     inr AS (SELECT * FROM s WHERE d BETWEEN $1::date AND $2::date),
     firsts AS (SELECT ckey, MIN(d) AS first_d FROM s WHERE named GROUP BY ckey)
     SELECT
       (SELECT COALESCE(SUM(total), 0)::float FROM inr) AS revenue,
       (SELECT COUNT(*)::int FROM inr) AS sales_count,
       (SELECT COALESCE(SUM(si.line_total - si.unit_cost_snapshot * si.quantity), 0)::float
          FROM sale_items si JOIN inr ON inr.id = si.sale_id) AS gross_profit,
       (SELECT COUNT(DISTINCT ckey)::int FROM inr WHERE named) AS customers_served,
       (SELECT COUNT(*)::int FROM firsts WHERE first_d BETWEEN $1::date AND $2::date) AS new_customers`,
    [from, to]
  );
  return rows[0];
}
