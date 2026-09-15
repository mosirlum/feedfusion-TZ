import { PoolClient } from 'pg';
import { pool } from './pool';

/**
 * Runs `fn` inside a single BEGIN/COMMIT transaction on a dedicated client.
 * If `fn` throws, the transaction is rolled back and the error propagates.
 *
 * This is the ONLY sanctioned way services should group multiple writes that
 * must succeed or fail together (sale completion, price approval, stock
 * adjustment approval, etc.) — see architecture.md's sale-completion section.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
