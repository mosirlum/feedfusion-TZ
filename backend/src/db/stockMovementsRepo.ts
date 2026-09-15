import { PoolClient } from 'pg';
import { pool } from './pool';

export type MovementType = 'PURCHASE' | 'SALE' | 'VOID_REVERSAL' | 'ADJUSTMENT' | 'COUNT_CORRECTION';

/**
 * Current stock is SUM(quantity) over stock_movements — never a stored
 * column (CLAUDE.md rule #1). Call this only AFTER locking the product row
 * (`SELECT ... FOR UPDATE`) in the same transaction, so the sum can't shift
 * under a concurrent writer between the read and the movement insert that
 * follows it.
 */
export async function getCurrentStock(productId: number, client: PoolClient): Promise<number> {
  const { rows } = await client.query(
    'SELECT COALESCE(SUM(quantity), 0)::int AS stock FROM stock_movements WHERE product_id = $1',
    [productId]
  );
  return rows[0].stock;
}

export async function insertStockMovement(
  input: {
    productId: number;
    movementType: MovementType;
    quantity: number; // signed: + in, - out
    referenceType?: string;
    referenceId?: number;
    createdBy: number;
  },
  client: PoolClient
) {
  const currentStock = await getCurrentStock(input.productId, client);
  const balanceAfter = currentStock + input.quantity;

  const { rows } = await client.query(
    `INSERT INTO stock_movements
       (product_id, movement_type, quantity, reference_type, reference_id, balance_after, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.productId,
      input.movementType,
      input.quantity,
      input.referenceType ?? null,
      input.referenceId ?? null,
      balanceAfter,
      input.createdBy,
    ]
  );
  return rows[0];
}

export async function listMovementsForProduct(productId: number) {
  const { rows } = await pool.query(
    `SELECT sm.*, u.name AS created_by_name
     FROM stock_movements sm
     JOIN users u ON u.id = sm.created_by
     WHERE sm.product_id = $1
     ORDER BY sm.created_at DESC, sm.id DESC`,
    [productId]
  );
  return rows;
}

export async function getCurrentStockUnlocked(productId: number): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(quantity), 0)::int AS stock FROM stock_movements WHERE product_id = $1',
    [productId]
  );
  return rows[0].stock;
}

/**
 * Bulk current-stock-per-product, and NOTHING else — no cost, no stock
 * value (2026-09-11, New Sale page redesign). BR-24 says product COST must
 * not be exposed to sales users; it says nothing about stock QUANTITY,
 * which a sales user legitimately needs to see before adding something to
 * a cart. `GET /inventory` (the existing bulk stock endpoint) is owner-only
 * specifically because it also carries cost/stock-value fields — this is a
 * separate, deliberately narrower query so the New Sale page's product list
 * can show "Available: 115" to a sales user without needing owner access.
 */
export async function getStockLevels(): Promise<Array<{ product_id: number; current_stock: number }>> {
  const { rows } = await pool.query(`
    SELECT p.id AS product_id, COALESCE(sm.balance, 0)::int AS current_stock
    FROM products p
    LEFT JOIN LATERAL (
      SELECT balance_after AS balance
      FROM stock_movements
      WHERE product_id = p.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) sm ON true
  `);
  return rows;
}
