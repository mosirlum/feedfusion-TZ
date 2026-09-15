import { PoolClient } from 'pg';
import { pool } from './pool';

export async function listProducts(includeUnpriced: boolean) {
  const where = includeUnpriced ? '' : 'WHERE p.active_price IS NOT NULL';
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${where}
     ORDER BY p.name ASC`
  );
  return rows;
}

export async function searchSellableProducts(q: string) {
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.active_price IS NOT NULL
       AND p.status = 'active'
       AND p.name ILIKE $1
     ORDER BY p.name ASC
     LIMIT 50`,
    [`%${q}%`]
  );
  return rows;
}

export async function findProductById(id: number, client?: PoolClient) {
  const runner = client ?? pool;
  const { rows } = await runner.query('SELECT * FROM products WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** Locks the product row — use inside a transaction before mutating price or reading it for a sale. */
export async function findProductByIdForUpdate(id: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
}

export async function createProduct(input: {
  name: string;
  categoryId?: number | null;
  unit: string;
  minimumStock?: number;
}) {
  const { rows } = await pool.query(
    `INSERT INTO products (name, category_id, unit, minimum_stock)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.name, input.categoryId ?? null, input.unit, input.minimumStock ?? 0]
  );
  return rows[0];
}

export async function updateProductStatus(id: number, status: 'active' | 'inactive') {
  const { rows } = await pool.query(
    `UPDATE products SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] ?? null;
}

export async function setProductActivePrice(
  productId: number,
  price: number,
  source: 'OWNER_SET' | 'APPROVED_PROPOSAL',
  changedBy: number,
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE products
     SET active_price = $1, active_price_source = $2, price_last_changed_at = now(), price_last_changed_by = $3
     WHERE id = $4
     RETURNING *`,
    [price, source, changedBy, productId]
  );
  return rows[0];
}
