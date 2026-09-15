import { pool } from './pool';

// New Customers module (2026-09-12, Quotations feature, CLAUDE.md #49) —
// mirrors suppliersRepo.ts's shape closely, since the two entities are
// structurally the same (name/phone/email/address/notes/status).

export async function listCustomers() {
  const { rows } = await pool.query('SELECT * FROM customers ORDER BY name ASC');
  return rows;
}

// Backs the "Ship To" autocomplete on the Quotation form — matches on name
// OR phone, case-insensitively, capped at 10 so a fast typist never waits
// on a huge result set. Empty/whitespace query returns the most recently
// added customers instead of nothing, so opening the picker isn't a blank
// box on a shop with only a handful of customers.
export async function searchCustomers(q: string) {
  const query = q.trim();
  if (!query) {
    const { rows } = await pool.query(
      `SELECT * FROM customers WHERE status = 'active' ORDER BY created_at DESC LIMIT 10`
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT * FROM customers
     WHERE status = 'active' AND (name ILIKE $1 OR phone ILIKE $1)
     ORDER BY name ASC
     LIMIT 10`,
    [`%${query}%`]
  );
  return rows;
}

export async function findCustomerById(id: number) {
  const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createCustomer(input: {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdBy: number;
}) {
  const { rows } = await pool.query(
    `INSERT INTO customers (name, phone, email, address, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.name, input.phone ?? null, input.email ?? null, input.address ?? null, input.notes ?? null, input.createdBy]
  );
  return rows[0];
}

export async function updateCustomer(
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
    return findCustomerById(id);
  }
  values.push(id);
  const { rows } = await pool.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return rows[0] ?? null;
}
