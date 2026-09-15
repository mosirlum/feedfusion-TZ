import { pool } from './pool';

export async function listCategories() {
  const { rows } = await pool.query(
    'SELECT * FROM categories ORDER BY parent_id NULLS FIRST, name ASC'
  );
  return rows;
}

export async function createCategory(input: { name: string; parentId?: number | null }) {
  const { rows } = await pool.query(
    'INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING *',
    [input.name, input.parentId ?? null]
  );
  return rows[0];
}
