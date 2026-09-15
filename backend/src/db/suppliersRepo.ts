import { pool } from './pool';

// Enhanced 2026-09-11 for the redesigned Suppliers page — each supplier now
// carries its all-time purchase totals (for the table's "Total Purchases" /
// "Last Purchase" columns) computed with a single aggregate join, rather
// than the page fetching every supplier's purchase history individually.
export async function listSuppliers() {
  const { rows } = await pool.query(
    `SELECT
       s.*,
       COALESCE(pa.total_purchases, 0) AS total_purchases,
       COALESCE(pa.purchase_count, 0)::int AS purchase_count,
       pa.last_purchase_date
     FROM suppliers s
     LEFT JOIN (
       SELECT supplier_id,
              SUM(total_cost) AS total_purchases,
              COUNT(*) AS purchase_count,
              MAX(purchase_date) AS last_purchase_date
       FROM purchases
       GROUP BY supplier_id
     ) pa ON pa.supplier_id = s.id
     ORDER BY s.name ASC`
  );
  return rows;
}

export async function createSupplier(input: {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO suppliers (name, phone, email, address, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.name, input.phone ?? null, input.email ?? null, input.address ?? null, input.notes ?? null]
  );
  return rows[0];
}

// Edit an existing supplier's own details (2026-09-11, Suppliers page
// redesign) — only ever the fields already on this table; `undefined`
// leaves a field untouched, so a caller can send just `{ phone }` without
// wiping out the rest.
export async function updateSupplier(
  id: number,
  patch: { name?: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; status?: 'active' | 'inactive' }
) {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, column] of [
    ['name', 'name'],
    ['phone', 'phone'],
    ['email', 'email'],
    ['address', 'address'],
    ['notes', 'notes'],
    ['status', 'status'],
  ] as const) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = $${i}`);
      values.push(patch[key]);
      i += 1;
    }
  }
  if (fields.length === 0) {
    return findSupplierById(id);
  }
  values.push(id);
  const { rows } = await pool.query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return rows[0] ?? null;
}

export async function findSupplierById(id: number) {
  const { rows } = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
  return rows[0] ?? null;
}

// Backs the redesigned Suppliers page's stat cards, "Purchase Share by
// Supplier" / "Top Suppliers by Purchase Value" charts, and its insights —
// all real, computed figures (this project deliberately doesn't fabricate
// an "average delivery time" or similar, since nothing in this schema
// records an expected-vs-actual delivery date — see CLAUDE.md).
export async function getSupplierStats() {
  const totalsQuery = pool.query(
    `SELECT
       (SELECT COUNT(*) FROM suppliers WHERE status = 'active')::int AS total_suppliers,
       (SELECT COUNT(*) FROM suppliers WHERE created_at >= date_trunc('month', CURRENT_DATE))::int AS new_suppliers_this_month,
       (SELECT COALESCE(SUM(total_cost), 0) FROM purchases WHERE purchase_date >= date_trunc('month', CURRENT_DATE)) AS total_this_month,
       (SELECT COALESCE(SUM(total_cost), 0) FROM purchases
          WHERE purchase_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
            AND purchase_date < date_trunc('month', CURRENT_DATE)) AS total_last_month,
       (SELECT COUNT(*) FROM purchases WHERE purchase_date >= date_trunc('month', CURRENT_DATE))::int AS purchase_count_this_month`
  );
  const bySupplierQuery = pool.query(
    `SELECT s.id, s.name, COALESCE(SUM(p.total_cost), 0) AS total_cost_this_month
     FROM suppliers s
     LEFT JOIN purchases p ON p.supplier_id = s.id AND p.purchase_date >= date_trunc('month', CURRENT_DATE)
     WHERE s.status = 'active'
     GROUP BY s.id, s.name
     ORDER BY total_cost_this_month DESC`
  );
  const [totals, bySupplier] = await Promise.all([totalsQuery, bySupplierQuery]);
  return { ...totals.rows[0], bySupplier: bySupplier.rows };
}

export async function getPurchasesForSupplier(supplierId: number) {
  const { rows } = await pool.query(
    `SELECT pu.*, u.name AS created_by_name
     FROM purchases pu
     JOIN users u ON u.id = pu.created_by
     WHERE pu.supplier_id = $1
     ORDER BY pu.purchase_date DESC, pu.id DESC`,
    [supplierId]
  );
  return rows;
}
