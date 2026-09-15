import { pool } from './pool';

export async function insertExpense(input: {
  category: string;
  amount: number;
  description: string | null;
  expenseDate: string | null;
  expenseType: 'PER_PURCHASE' | 'MONTHLY' | 'PERIODIC';
  createdBy: number;
}) {
  const { rows } = await pool.query(
    `INSERT INTO expenses (category, amount, description, expense_date, expense_type, created_by)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6)
     RETURNING *`,
    [input.category, input.amount, input.description, input.expenseDate, input.expenseType, input.createdBy]
  );
  return rows[0];
}

export async function listExpenses(filters: { from?: string; to?: string; expenseType?: string }) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.from) {
    values.push(filters.from);
    conditions.push(`e.expense_date >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`e.expense_date <= $${values.length}`);
  }
  if (filters.expenseType) {
    values.push(filters.expenseType);
    conditions.push(`e.expense_type = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT e.*, u.name AS created_by_name
     FROM expenses e
     JOIN users u ON u.id = e.created_by
     ${where}
     ORDER BY e.expense_date DESC, e.id DESC
     LIMIT 1000`,
    values
  );
  return rows;
}

export async function sumExpensesForDate(date: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE expense_date = $1`,
    [date]
  );
  return Number(rows[0].total);
}

export async function sumExpensesForRange(from: string, to: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE expense_date BETWEEN $1 AND $2`,
    [from, to]
  );
  return Number(rows[0].total);
}
