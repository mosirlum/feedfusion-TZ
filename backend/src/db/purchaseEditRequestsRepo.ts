import { PoolClient } from 'pg';
import { pool } from './pool';

export interface ProposedItemPatch {
  purchaseItemId: number;
  quantity: number;
  unitCost: number;
}

export interface ProposedCostLinePatch {
  costLineId: number;
  amount: number;
}

export async function insertEditRequest(
  input: {
    purchaseId: number;
    proposedItems: ProposedItemPatch[];
    proposedCostLines: ProposedCostLinePatch[];
    reason: string | null;
    requestedBy: number;
    status: 'PENDING' | 'APPROVED';
    reviewedBy?: number | null;
    reviewedAt?: Date | null;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO purchase_edit_requests
       (purchase_id, proposed_items, proposed_cost_lines, reason, requested_by, status, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.purchaseId,
      JSON.stringify(input.proposedItems),
      JSON.stringify(input.proposedCostLines),
      input.reason,
      input.requestedBy,
      input.status,
      input.reviewedBy ?? null,
      input.reviewedAt ?? null,
    ]
  );
  return rows[0];
}

// Only one PENDING edit request per purchase at a time, mirroring the same
// rule already used for price proposals (CLAUDE.md judgment call #6) — a
// second submission while one is still awaiting the owner is rejected
// rather than allowed to queue up alongside it.
export async function findPendingForPurchase(purchaseId: number, client: PoolClient) {
  const { rows } = await client.query(
    `SELECT * FROM purchase_edit_requests WHERE purchase_id = $1 AND status = 'PENDING' FOR UPDATE`,
    [purchaseId]
  );
  return rows[0] ?? null;
}

export async function findByIdForUpdate(id: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM purchase_edit_requests WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
}

export async function reviewEditRequest(
  id: number,
  status: 'APPROVED' | 'REJECTED',
  reviewedBy: number,
  notes: string | null,
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE purchase_edit_requests
     SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = COALESCE($3, review_notes)
     WHERE id = $4
     RETURNING *`,
    [status, reviewedBy, notes, id]
  );
  return rows[0];
}

export async function listEditRequests(status?: string) {
  const where = status ? 'WHERE per.status = $1' : '';
  const values = status ? [status] : [];
  const { rows } = await pool.query(
    `SELECT per.*, pu.reference_number, pu.supplier_id, pu.total_cost, s.name AS supplier_name,
            u.name AS requested_by_name, u.role AS requested_by_role,
            r.name AS reviewed_by_name
     FROM purchase_edit_requests per
     JOIN purchases pu ON pu.id = per.purchase_id
     JOIN suppliers s ON s.id = pu.supplier_id
     JOIN users u ON u.id = per.requested_by
     LEFT JOIN users r ON r.id = per.reviewed_by
     ${where}
     ORDER BY per.created_at DESC`,
    values
  );
  return rows;
}

// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — see
// priceProposalsRepo's identical pattern.
export async function getApprovalCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
       COUNT(*) FILTER (WHERE status = 'APPROVED' AND reviewed_at::date = CURRENT_DATE) AS approved_today,
       COUNT(*) FILTER (WHERE status = 'APPROVED' AND reviewed_at::date = CURRENT_DATE - INTERVAL '1 day') AS approved_yesterday,
       COUNT(*) FILTER (WHERE status = 'REJECTED' AND reviewed_at::date = CURRENT_DATE) AS rejected_today
     FROM purchase_edit_requests`
  );
  return rows[0];
}

export async function listRecentlyReviewed(limit: number) {
  const { rows } = await pool.query(
    `SELECT per.id, per.status, per.reviewed_at, pu.reference_number, r.name AS reviewed_by_name
     FROM purchase_edit_requests per
     JOIN purchases pu ON pu.id = per.purchase_id
     LEFT JOIN users r ON r.id = per.reviewed_by
     WHERE per.status IN ('APPROVED', 'REJECTED') AND per.reviewed_at IS NOT NULL
     ORDER BY per.reviewed_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
