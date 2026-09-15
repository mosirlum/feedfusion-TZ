import { PoolClient } from 'pg';
import { pool } from './pool';

export async function insertPurchase(
  input: {
    supplierId: number;
    referenceNumber: string;
    purchaseDate?: string;
    additionalCosts: number;
    totalCost: number;
    notes?: string;
    documentDataUrl?: string | null;
    createdBy: number;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO purchases (supplier_id, reference_number, purchase_date, additional_costs, total_cost, notes, document_data_url, created_by)
     VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.supplierId,
      input.referenceNumber,
      input.purchaseDate ?? null,
      input.additionalCosts,
      input.totalCost,
      input.notes ?? null,
      input.documentDataUrl ?? null,
      input.createdBy,
    ]
  );
  return rows[0];
}

export async function insertPurchaseItem(
  input: {
    purchaseId: number;
    productId: number;
    quantity: number;
    unitCost: number;
    allocatedAdditionalCost: number;
    totalCost: number;
  },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, allocated_additional_cost, total_cost)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.purchaseId, input.productId, input.quantity, input.unitCost, input.allocatedAdditionalCost, input.totalCost]
  );
  return rows[0];
}

export async function insertAdditionalCostLine(
  input: { purchaseId: number; label: string; amount: number },
  client: PoolClient
) {
  const { rows } = await client.query(
    `INSERT INTO purchase_additional_cost_lines (purchase_id, label, amount)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.purchaseId, input.label, input.amount]
  );
  return rows[0];
}

export async function getAdditionalCostLines(purchaseId: number, queryable: PoolClient | typeof pool = pool) {
  const { rows } = await queryable.query(
    `SELECT * FROM purchase_additional_cost_lines WHERE purchase_id = $1 ORDER BY id ASC`,
    [purchaseId]
  );
  return rows;
}

/**
 * `queryable` defaults to the shared `pool` for normal reads (GET
 * /purchases/:id, etc.), but MUST be passed the transaction's own `client`
 * when called from inside `createPurchase`'s `withTransaction` — a purchase
 * just inserted on that transaction hasn't committed yet, so reading it back
 * through a *different* pooled connection (the default `pool.query`) can't
 * see it under Postgres's normal READ COMMITTED isolation and silently
 * returns null even though the insert is about to succeed. That's exactly
 * the bug behind "could not record this purchase" showing on every save
 * despite the purchase actually being there (fixed 2026-09-11, see
 * CLAUDE.md).
 */
export async function findPurchaseById(id: number, queryable: PoolClient | typeof pool = pool) {
  const { rows } = await queryable.query(
    `SELECT pu.*, s.name AS supplier_name, u.name AS created_by_name
     FROM purchases pu
     JOIN suppliers s ON s.id = pu.supplier_id
     JOIN users u ON u.id = pu.created_by
     WHERE pu.id = $1`,
    [id]
  );
  if (!rows[0]) return null;

  const { rows: items } = await queryable.query(
    `SELECT pi.*, p.name AS product_name, p.unit
     FROM purchase_items pi
     JOIN products p ON p.id = pi.product_id
     WHERE pi.purchase_id = $1`,
    [id]
  );
  const additionalCostLines = await getAdditionalCostLines(id, queryable);
  return { ...rows[0], items, additional_cost_lines: additionalCostLines };
}

export async function findPurchaseByIdForUpdate(id: number, client: PoolClient) {
  const { rows } = await client.query('SELECT * FROM purchases WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
}

// Locked reads used while applying an approved purchase-edit request (see
// purchases.service.ts's applyPurchaseEdit) — locking every item/cost-line
// row on the purchase before recomputing allocation keeps a second edit
// request on the same purchase from being approved concurrently and
// clobbering this one's math.
export async function getPurchaseItemsForUpdate(purchaseId: number, client: PoolClient) {
  const { rows } = await client.query(`SELECT * FROM purchase_items WHERE purchase_id = $1 ORDER BY id ASC FOR UPDATE`, [
    purchaseId,
  ]);
  return rows;
}

export async function getAdditionalCostLinesForUpdate(purchaseId: number, client: PoolClient) {
  const { rows } = await client.query(
    `SELECT * FROM purchase_additional_cost_lines WHERE purchase_id = $1 ORDER BY id ASC FOR UPDATE`,
    [purchaseId]
  );
  return rows;
}

export async function updatePurchaseItem(
  id: number,
  patch: { quantity: number; unitCost: number; allocatedAdditionalCost: number; totalCost: number },
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE purchase_items SET quantity = $1, unit_cost = $2, allocated_additional_cost = $3, total_cost = $4 WHERE id = $5 RETURNING *`,
    [patch.quantity, patch.unitCost, patch.allocatedAdditionalCost, patch.totalCost, id]
  );
  return rows[0];
}

export async function updateCostLineAmount(id: number, amount: number, client: PoolClient) {
  const { rows } = await client.query(
    `UPDATE purchase_additional_cost_lines SET amount = $1 WHERE id = $2 RETURNING *`,
    [amount, id]
  );
  return rows[0];
}

export async function updatePurchaseTotals(
  purchaseId: number,
  patch: { additionalCosts: number; totalCost: number },
  client: PoolClient
) {
  const { rows } = await client.query(
    `UPDATE purchases SET additional_costs = $1, total_cost = $2 WHERE id = $3 RETURNING *`,
    [patch.additionalCosts, patch.totalCost, purchaseId]
  );
  return rows[0];
}

export async function listPurchases(limit = 50) {
  // document_data_url (migration 020) deliberately left out of the list
  // query — it's a base64 photo that can run several hundred KB each, and
  // pulling that for every one of up to 50 rows on every page load would
  // bloat this response badly for no benefit (the list view never shows
  // the photo itself, just whether one exists). `has_document` is a cheap
  // boolean instead; the full photo is only ever fetched by
  // findPurchaseById, when a single purchase is actually opened.
  const { rows } = await pool.query(
    `SELECT pu.id, pu.supplier_id, pu.reference_number, pu.purchase_date, pu.additional_costs,
            pu.total_cost, pu.notes, pu.created_by, pu.created_at,
            (pu.document_data_url IS NOT NULL) AS has_document,
            s.name AS supplier_name,
            (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id) AS item_count
     FROM purchases pu
     JOIN suppliers s ON s.id = pu.supplier_id
     ORDER BY pu.purchase_date DESC, pu.id DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
