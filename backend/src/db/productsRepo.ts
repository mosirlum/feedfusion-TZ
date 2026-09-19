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

export async function createProduct(
  input: {
    name: string;
    categoryId?: number | null;
    unit: string;
    minimumStock?: number;
  },
  client: PoolClient | typeof pool = pool
) {
  const { rows } = await client.query(
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

// Edit Product (2026-09-19, CLAUDE.md #69) — no field is required; the
// caller (products.service.ts) only ever sends the fields the owner
// actually changed. Building the SET clause dynamically rather than always
// writing all four columns keeps an unrelated field from being silently
// reset to undefined/null if a future caller forgets to pass it.
export async function updateProductDetails(
  id: number,
  patch: { name?: string; categoryId?: number | null; unit?: string; minimumStock?: number }
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    values.push(patch.name);
    sets.push(`name = $${values.length}`);
  }
  if (patch.categoryId !== undefined) {
    values.push(patch.categoryId);
    sets.push(`category_id = $${values.length}`);
  }
  if (patch.unit !== undefined) {
    values.push(patch.unit);
    sets.push(`unit = $${values.length}`);
  }
  if (patch.minimumStock !== undefined) {
    values.push(patch.minimumStock);
    sets.push(`minimum_stock = $${values.length}`);
  }
  if (sets.length === 0) {
    return findProductById(id);
  }
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

// Permanent Delete Product (2026-09-19, CLAUDE.md #69) — the owner asked
// for a real delete, not just Deactivate, with a warning against doing it
// by accident. Same convention already used for deleting a user
// (usersRepo.deleteUser / users.service.ts's isForeignKeyViolation): just
// attempt the DELETE and let products.service.ts translate a real Postgres
// foreign-key violation (code 23503) into a clear message, rather than
// pre-checking every referencing table by hand here — sale_items,
// purchase_items, stock_movements, stock_counts, stock_adjustments,
// price_proposals and quotation_items (migrations 002/003/004/005/006/017)
// all REFERENCE products(id) with no ON DELETE CASCADE, and Postgres
// enforces that whether or not this list stays exhaustive.
export async function deleteProduct(id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
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
