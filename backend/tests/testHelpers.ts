import { pool } from '../src/db/pool';
import { hashPassword } from '../src/utils/password';
import { UserRole, UserStatus } from '../src/types/auth';

const RETRYABLE_CODES = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']);

/**
 * Wraps a DB call with a few retries. This project's dev/test databases are
 * Neon (cloud Postgres); short DNS/connection blips have been observed on
 * some Windows setups and shouldn't fail an otherwise-correct test.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (!RETRYABLE_CODES.has(err?.code) || i === attempts - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

const TABLES = [
  'audit_logs',
  'cash_counts',
  'expenses',
  'stock_adjustments',
  'stock_counts',
  'payments',
  'sale_items',
  'sales',
  'stock_movements',
  'purchase_items',
  'purchases',
  'price_proposals',
  'products',
  'categories',
  'suppliers',
  'users',
  'business_settings',
];

export async function resetDatabase(): Promise<void> {
  await withRetry(() => pool.query(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
}

export async function insertTestUser(input: {
  name?: string;
  email: string;
  password: string;
  role?: UserRole;
  status?: UserStatus;
}) {
  const passwordHash = await hashPassword(input.password);
  const { rows } = await withRetry(() =>
    pool.query(
      `INSERT INTO users (name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.name ?? 'Test User', input.email, passwordHash, input.role ?? 'sales', input.status ?? 'active']
    )
  );
  return rows[0];
}

export async function insertBusinessSettings(overrides: Partial<{
  businessName: string;
  defaultMaxDiscountPct: number;
}> = {}) {
  const { rows } = await withRetry(() =>
    pool.query(
      `INSERT INTO business_settings (business_name, currency, default_max_discount_pct)
       VALUES ($1, 'TZS', $2)
       RETURNING *`,
      [overrides.businessName ?? 'Feed Fusion Tanzania', overrides.defaultMaxDiscountPct ?? 5.0]
    )
  );
  return rows[0];
}

export async function insertTestCategory(name = 'Fish Feed') {
  const { rows } = await withRetry(() =>
    pool.query('INSERT INTO categories (name) VALUES ($1) RETURNING *', [name])
  );
  return rows[0];
}

export async function insertTestProduct(input: {
  name?: string;
  categoryId?: number | null;
  unit?: string;
  minimumStock?: number;
  activePrice?: number | null;
}) {
  const { rows } = await withRetry(() =>
    pool.query(
      `INSERT INTO products (name, category_id, unit, minimum_stock, active_price, active_price_source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.name ?? 'Test Product',
        input.categoryId ?? null,
        input.unit ?? 'kg',
        input.minimumStock ?? 0,
        input.activePrice ?? null,
        input.activePrice != null ? 'OWNER_SET' : null,
      ]
    )
  );
  return rows[0];
}

export async function insertStockMovement(input: {
  productId: number;
  movementType: string;
  quantity: number;
  balanceAfter: number;
  createdBy: number;
}) {
  const { rows } = await withRetry(() =>
    pool.query(
      `INSERT INTO stock_movements (product_id, movement_type, quantity, balance_after, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.productId, input.movementType, input.quantity, input.balanceAfter, input.createdBy]
    )
  );
  return rows[0];
}

export async function closePool(): Promise<void> {
  await pool.end();
}
