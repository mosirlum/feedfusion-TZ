import { PoolClient } from 'pg';
import { pool } from './pool';

export async function insertStockAdjustment(
  input: {
    productId: number;
    quantity: number;
    reason: string;
    notes?: string | null;
    createdBy: number;
    approvedBy: number | null;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO stock_adjustments (product_id, quantity, reason, notes, created_by, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [input.productId, input.quantity, input.reason, input.notes ?? null, input.createdBy, input.approvedBy]
  );
  return rows[0];
}

export async function listStockAdjustments() {
  const { rows } = await pool.query(
    `SELECT sa.*, p.name AS product_name, p.unit, p.category_id, c.name AS category_name,
            u1.name AS created_by_name, u1.role AS created_by_role, u2.name AS approved_by_name
     FROM stock_adjustments sa
     JOIN products p ON p.id = sa.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     JOIN users u1 ON u1.id = sa.created_by
     LEFT JOIN users u2 ON u2.id = sa.approved_by
     ORDER BY sa.created_at DESC`
  );
  return rows;
}

/**
 * Stock Adjustments Center redesign (2026-09-12, CLAUDE.md #38). Unlike Stock
 * Count / the 3 approval-center tables, adjustments have no PENDING/APPROVED
 * status at all (Section 23: owner-only, applies immediately) — so there's
 * nothing to count as "pending." Instead this powers the mockup's stat row:
 * counts of today's/yesterday's adjustments, and a 7-day-vs-prior-7-day
 * "units written off" figure. "Written off" is a judgment call (see
 * CLAUDE.md #38): it sums the magnitude of DECREASE adjustments whose reason
 * reflects genuine loss (Damaged/Expired/Lost), excluding Correction (a
 * bookkeeping fix, not a loss) and Found (a positive adjustment).
 */
export async function getSummaryCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS adjustments_today,
       COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day') AS adjustments_yesterday,
       COALESCE(SUM(ABS(quantity)) FILTER (
         WHERE quantity < 0 AND reason IN ('Damaged', 'Expired', 'Lost')
           AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       ), 0) AS written_off_last7,
       COALESCE(SUM(ABS(quantity)) FILTER (
         WHERE quantity < 0 AND reason IN ('Damaged', 'Expired', 'Lost')
           AND created_at >= CURRENT_DATE - INTERVAL '14 days'
           AND created_at < CURRENT_DATE - INTERVAL '7 days'
       ), 0) AS written_off_prior7,
       COALESCE(SUM(quantity) FILTER (
         WHERE quantity > 0 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       ), 0) AS increased_last7,
       COALESCE(SUM(ABS(quantity)) FILTER (
         WHERE quantity < 0 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       ), 0) AS decreased_last7
     FROM stock_adjustments`
  );
  const r = rows[0];
  return {
    adjustmentsToday: Number(r.adjustments_today),
    adjustmentsYesterday: Number(r.adjustments_yesterday),
    writtenOffLast7: Number(r.written_off_last7),
    writtenOffPrior7: Number(r.written_off_prior7),
    increasedLast7: Number(r.increased_last7),
    decreasedLast7: Number(r.decreased_last7),
  };
}
