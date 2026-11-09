import { pool } from './pool';

// Queries behind "Profit Doctor" (CLAUDE.md #95). All read-only. Revenue/cost
// use the same sources as the Reports (sale_items.line_total and the
// unit_cost_snapshot taken at sale time), so the doctor's numbers always agree
// with the Net Profit card.

// LATERAL: the most recent purchase's landed cost per unit (unit cost plus its
// share of transport etc.) for each product. Used to spot cost increases that
// the selling price has not followed, and to value stock losses.
const LATEST_COST = `(
  SELECT (pi.total_cost / NULLIF(pi.quantity, 0))::float
  FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
  WHERE pi.product_id = %P%
  ORDER BY pu.purchase_date DESC, pi.id DESC LIMIT 1
)`;

export async function productEconomics(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT si.product_id, p.name AS product_name, p.unit, p.active_price::float AS active_price,
            SUM(si.quantity)::float AS qty,
            SUM(si.line_total)::float AS revenue,
            SUM(si.discount_amount)::float AS discount,
            SUM(si.unit_cost_snapshot * si.quantity)::float AS cost,
            ${LATEST_COST.replace('%P%', 'si.product_id')} AS latest_cost
     FROM sale_items si
     JOIN sales sa ON sa.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     WHERE sa.sale_date::date BETWEEN $1 AND $2 AND sa.status = 'COMPLETED'
     GROUP BY si.product_id, p.name, p.unit, p.active_price`,
    [from, to]
  );
  return rows as Array<{
    product_id: number; product_name: string; unit: string; active_price: number | null;
    qty: number; revenue: number; discount: number; cost: number; latest_cost: number | null;
  }>;
}

export async function belowCostSales(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS lines,
            COALESCE(SUM(si.unit_cost_snapshot * si.quantity - si.line_total), 0)::float AS loss
     FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
     WHERE sa.sale_date::date BETWEEN $1 AND $2 AND sa.status = 'COMPLETED'
       AND si.line_total < si.unit_cost_snapshot * si.quantity`,
    [from, to]
  );
  return rows[0] as { lines: number; loss: number };
}

export async function customerDiscounts(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(sa.customer_name), ''), 'Walk-in customers') AS customer,
            SUM(si.line_total)::float AS revenue,
            SUM(si.discount_amount)::float AS discount,
            SUM(si.line_total - si.unit_cost_snapshot * si.quantity)::float AS gross_profit
     FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
     WHERE sa.sale_date::date BETWEEN $1 AND $2 AND sa.status = 'COMPLETED'
     GROUP BY 1
     HAVING SUM(si.discount_amount) > 0
     ORDER BY SUM(si.discount_amount) DESC
     LIMIT 5`,
    [from, to]
  );
  return rows as Array<{ customer: string; revenue: number; discount: number; gross_profit: number }>;
}

export async function stockLosses(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT p.name AS product_name,
            SUM(-a.quantity)::float AS units,
            (SUM(-a.quantity) * COALESCE(${LATEST_COST.replace('%P%', 'a.product_id')}, 0))::float AS value
     FROM stock_adjustments a JOIN products p ON p.id = a.product_id
     WHERE a.created_at::date BETWEEN $1 AND $2 AND a.quantity < 0
     GROUP BY a.product_id, p.name
     ORDER BY value DESC`,
    [from, to]
  );
  return rows as Array<{ product_name: string; units: number; value: number }>;
}

export async function overdueReceivables() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(sa.total - COALESCE(pay.paid, 0)), 0)::float AS overdue_amount,
            COUNT(*)::int AS overdue_count
     FROM sales sa
     LEFT JOIN (SELECT sale_id, SUM(amount) AS paid FROM payments GROUP BY sale_id) pay ON pay.sale_id = sa.id
     WHERE sa.status = 'COMPLETED' AND sa.payment_status = 'PARTIAL'
       AND (sa.total - COALESCE(pay.paid, 0)) > 0
       AND sa.due_date IS NOT NULL AND sa.due_date < CURRENT_DATE`
  );
  return rows[0] as { overdue_amount: number; overdue_count: number };
}
