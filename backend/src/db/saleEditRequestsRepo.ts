import { PoolClient } from 'pg';
import { pool } from './pool';

export interface ProposedSaleItemPatch {
  saleItemId: number;
  quantity: number;
  unitPrice: number;
  discountType: 'NONE' | 'FIXED' | 'PERCENT';
  discountValue: number;
  discountReason: string | null;
}

export async function insertEditRequest(
  input: {
    saleId: number;
    proposedItems: ProposedSaleItemPatch[];
    reason: string | null;
    requestedBy: number;
    status: 'PENDING' | 'APPROVED';
    reviewedBy?: number | null;
    reviewedAt?: Date | null;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO sale_edit_requests
       (sale_id, proposed_items, reason, requested_by, status, reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.saleId,
      JSON.stringify(input.proposedItems),
      input.reason,
      input.requestedBy,
      input.status,
      input.reviewedBy ?? null,
      input.reviewedAt ?? null,
    ]
  );
  return rows[0];
}

// Only one PENDING edit request per sale at a time — same rule as price
// proposals and purchase edit requests, so a second submission while one is
// still awaiting the owner is rejected rather than allowed to queue up.
export async function findPendingForSale(saleId: number, client: PoolClient) {
  const { rows } = await client.query(
    `SELECT * FROM sale_edit_requests WHERE sale_id = $1 AND status = 'PENDING' FOR UPDATE`,
    [saleId]
  );
  return rows[0] ?? null;
}

export async function findByIdForUpdate(id: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM sale_edit_requests WHERE id = $1 FOR UPDATE', [id]);
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
    `UPDATE sale_edit_requests
     SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = COALESCE($3, review_notes)
     WHERE id = $4
     RETURNING *`,
    [status, reviewedBy, notes, id]
  );
  return rows[0];
}

export async function listEditRequests(status?: string) {
  const where = status ? 'WHERE ser.status = $1' : '';
  const values = status ? [status] : [];
  const { rows } = await pool.query(
    `SELECT ser.*, sa.invoice_number, sa.customer_name, sa.total AS sale_total,
            u.name AS requested_by_name, u.role AS requested_by_role,
            r.name AS reviewed_by_name
     FROM sale_edit_requests ser
     JOIN sales sa ON sa.id = ser.sale_id
     JOIN users u ON u.id = ser.requested_by
     LEFT JOIN users r ON r.id = ser.reviewed_by
     ${where}
     ORDER BY ser.created_at DESC`,
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
     FROM sale_edit_requests`
  );
  return rows[0];
}

export async function listRecentlyReviewed(limit: number) {
  const { rows } = await pool.query(
    `SELECT ser.id, ser.status, ser.reviewed_at, sa.invoice_number, r.name AS reviewed_by_name
     FROM sale_edit_requests ser
     JOIN sales sa ON sa.id = ser.sale_id
     LEFT JOIN users r ON r.id = ser.reviewed_by
     WHERE ser.status IN ('APPROVED', 'REJECTED') AND ser.reviewed_at IS NOT NULL
     ORDER BY ser.reviewed_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
