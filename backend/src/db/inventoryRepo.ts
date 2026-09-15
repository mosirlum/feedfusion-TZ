import { pool } from './pool';

export async function getInventorySummary() {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.name, p.unit, p.active_price, p.minimum_stock, p.status,
      c.name AS category_name,
      COALESCE(sm.balance, 0)::int AS current_stock,
      sm.last_movement_at,
      lc.last_unit_cost
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT balance_after AS balance, created_at AS last_movement_at
      FROM stock_movements
      WHERE product_id = p.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) sm ON true
    LEFT JOIN LATERAL (
      SELECT (pi.unit_cost + pi.allocated_additional_cost / NULLIF(pi.quantity, 0)) AS last_unit_cost
      FROM purchase_items pi
      JOIN purchases pu ON pu.id = pi.purchase_id
      WHERE pi.product_id = p.id
      ORDER BY pu.purchase_date DESC, pi.id DESC
      LIMIT 1
    ) lc ON true
    ORDER BY p.name ASC
  `);
  return rows;
}
