import { PoolClient } from 'pg';
import { pool } from './pool';

export async function insertStockCount(
  input: {
    productId: number;
    expectedQty: number;
    physicalQty: number;
    difference: number;
    reason: string;
    notes?: string | null;
    countedBy: number;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO stock_counts (product_id, expected_qty, physical_qty, difference, reason, notes, counted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [input.productId, input.expectedQty, input.physicalQty, input.difference, input.reason, input.notes ?? null, input.countedBy]
  );
  return rows[0];
}

export async function findStockCountForUpdate(id: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
}

export async function reviewStockCount(
  id: number,
  status: 'APPROVED' | 'REJECTED',
  approvedBy: number,
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE stock_counts SET status = $1, approved_by = $2, reviewed_at = now() WHERE id = $3 RETURNING *`,
    [status, approvedBy, id]
  );
  return rows[0];
}

export async function listStockCounts() {
  const { rows } = await pool.query(
    `SELECT sc.*, p.name AS product_name, p.unit, p.category_id, c.name AS category_name,
            u1.name AS counted_by_name, u1.role AS counted_by_role, u2.name AS approved_by_name
     FROM stock_counts sc
     JOIN products p ON p.id = sc.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     JOIN users u1 ON u1.id = sc.counted_by
     LEFT JOIN users u2 ON u2.id = sc.approved_by
     ORDER BY sc.created_at DESC`
  );
  return rows;
}

// Stock Count Center redesign (2026-09-12, CLAUDE.md #37) — the 3 stat
// cards, one FILTER'd query. "Total Variance" is scoped to PENDING counts
// only — the sum of unresolved discrepancy currently awaiting the owner's
// review, not an all-time historical total (a judgment call, documented in
// CLAUDE.md since the mockup's "Across all products" caption doesn't say
// which population it means).
export async function getApprovalCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
       COALESCE(SUM(ABS(difference)) FILTER (WHERE status = 'PENDING'), 0) AS pending_variance,
       COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS counted_today,
       COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day') AS counted_yesterday,
       COUNT(*) FILTER (WHERE status = 'REJECTED' AND reviewed_at::date = CURRENT_DATE) AS rejected_today
     FROM stock_counts`
  );
  return rows[0];
}

// Recent Activity sidebar (same redesign) — the most recently touched rows,
// by either submission or review, whichever is later. The service layer
// expands each row into 1 or 2 timestamped events (RECORDED, and
// APPROVED/REJECTED if resolved) since a single row can represent both.
export async function listRecentRows(limit: number) {
  const { rows } = await pool.query(
    `SELECT sc.*, p.name AS product_name, p.unit, u1.name AS counted_by_name, u2.name AS approved_by_name
     FROM stock_counts sc
     JOIN products p ON p.id = sc.product_id
     JOIN users u1 ON u1.id = sc.counted_by
     LEFT JOIN users u2 ON u2.id = sc.approved_by
     ORDER BY GREATEST(sc.created_at, COALESCE(sc.reviewed_at, sc.created_at)) DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
