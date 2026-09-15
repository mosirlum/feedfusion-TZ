import { PoolClient } from 'pg';
import { pool } from './pool';

export async function findPendingProposalForProduct(productId: number, client: PoolClient) {
  const { rows } = await client.query(
    `SELECT * FROM price_proposals WHERE product_id = $1 AND status = 'PENDING' FOR UPDATE`,
    [productId]
  );
  return rows[0] ?? null;
}

export async function insertProposal(
  input: {
    productId: number;
    proposedPrice: number;
    currentActivePrice: number | null;
    proposedBy: number;
    status: 'PENDING' | 'APPROVED';
    reviewedBy?: number | null;
    reviewedAt?: Date | null;
    notes?: string | null;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO price_proposals
       (product_id, proposed_price, current_active_price, proposed_by, status, reviewed_by, reviewed_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.productId,
      input.proposedPrice,
      input.currentActivePrice,
      input.proposedBy,
      input.status,
      input.reviewedBy ?? null,
      input.reviewedAt ?? null,
      input.notes ?? null,
    ]
  );
  return rows[0];
}

export async function findProposalByIdForUpdate(id: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM price_proposals WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
}

export async function reviewProposal(
  id: number,
  status: 'APPROVED' | 'REJECTED',
  reviewedBy: number,
  notes: string | null,
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE price_proposals
     SET status = $1, reviewed_by = $2, reviewed_at = now(), notes = COALESCE($3, notes)
     WHERE id = $4
     RETURNING *`,
    [status, reviewedBy, notes, id]
  );
  return rows[0];
}

export async function listProposals(status?: string) {
  const where = status ? 'WHERE pp.status = $1' : '';
  const values = status ? [status] : [];
  const { rows } = await pool.query(
    `SELECT pp.*, p.name AS product_name, p.category_id, c.name AS category_name,
            u.name AS proposed_by_name, u.role AS proposed_by_role,
            r.name AS reviewed_by_name
     FROM price_proposals pp
     JOIN products p ON p.id = pp.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     JOIN users u ON u.id = pp.proposed_by
     LEFT JOIN users r ON r.id = pp.reviewed_by
     ${where}
     ORDER BY pp.created_at DESC`,
    values
  );
  return rows;
}

// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — one FILTER'd
// query gets every number the stat cards need in a single round trip rather
// than fetching full rows and counting client-side.
export async function getApprovalCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
       COUNT(*) FILTER (WHERE status = 'APPROVED' AND reviewed_at::date = CURRENT_DATE) AS approved_today,
       COUNT(*) FILTER (WHERE status = 'APPROVED' AND reviewed_at::date = CURRENT_DATE - INTERVAL '1 day') AS approved_yesterday,
       COUNT(*) FILTER (WHERE status = 'REJECTED' AND reviewed_at::date = CURRENT_DATE) AS rejected_today
     FROM price_proposals`
  );
  return rows[0];
}

// Recent Activity sidebar (CLAUDE.md #36) — the most recently resolved
// proposals, newest first, for merging into the cross-type activity feed.
export async function listRecentlyReviewed(limit: number) {
  const { rows } = await pool.query(
    `SELECT pp.id, pp.status, pp.reviewed_at, p.name AS product_name, r.name AS reviewed_by_name
     FROM price_proposals pp
     JOIN products p ON p.id = pp.product_id
     LEFT JOIN users r ON r.id = pp.reviewed_by
     WHERE pp.status IN ('APPROVED', 'REJECTED') AND pp.reviewed_at IS NOT NULL
     ORDER BY pp.reviewed_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
