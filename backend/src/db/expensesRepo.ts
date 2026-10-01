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

// Amortization for MONTHLY expenses (2026-10-01, CLAUDE.md #72) — the owner's
// own client saw a scary one-day "Loss" on the Dashboard because a single
// MONTHLY expense (e.g. Staff Salary, TZS 1,880,000) was counted in FULL
// against whatever one day it happened to be entered on, instead of being
// spread across the month it's meant to cover. This was a known, flagged gap
// (see CLAUDE.md #70/#71) — the 'MONTHLY' expense_type already existed and
// its own UI hint always described it as "a roughly fixed cost that repeats
// every month," but nothing ever actually amortized it.
//
// PERIODIC and PER_PURCHASE expenses are NOT amortized — they genuinely
// happened on one real day (a repair, an incidental purchase cost) and stay
// counted in full on their exact expense_date, same as before. Only MONTHLY
// is spread, evenly across the calendar month containing its expense_date
// (e.g. an expense dated 2026-09-30 spreads amount/30 across each of
// September's 30 days) — so "yesterday" or "last 7 days" only ever carries
// that day's/week's fair share, while a full calendar month still sums back
// to the original entered amount exactly.
//
// This does NOT change what's shown on the Expenses page itself (the actual
// entered amount, on its actual entered date) — only how much of a MONTHLY
// expense counts toward Net Profit for a given day/range. The separate
// PER_PURCHASE "Combined Overhead" report (#40, reportsRepo.ts) has its own
// query filtered to PER_PURCHASE only and is untouched by this change.
function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function toDateOnlyIso(value: string | Date): string {
  // pg returns a DATE column as a JS Date at UTC midnight for that calendar
  // day (no custom type parser is configured — see pool.ts), so reading the
  // UTC fields back out recovers the exact stored date, never drifting a day.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// The portion of one MONTHLY expense's amount that falls within [from, to]
// (inclusive ISO date strings), prorated evenly across the calendar month
// its own expense_date falls in.
function proratedMonthlyAmount(expenseDateIso: string, amount: number, from: string, to: string): number {
  const [y, m] = expenseDateIso.split('-').map(Number);
  const year = y;
  const monthIndex0 = m - 1;
  const totalDays = daysInMonth(year, monthIndex0);
  const monthStart = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;
  const overlapStart = monthStart > from ? monthStart : from;
  const overlapEnd = monthEnd < to ? monthEnd : to;
  if (overlapStart > overlapEnd) return 0;
  const overlapDays =
    Math.round((Date.parse(`${overlapEnd}T00:00:00Z`) - Date.parse(`${overlapStart}T00:00:00Z`)) / 86400000) + 1;
  return (amount / totalDays) * overlapDays;
}

export async function sumExpensesForRange(from: string, to: string): Promise<number> {
  const [lumpSumResult, monthlyRowsResult] = await Promise.all([
    // PERIODIC / PER_PURCHASE — unchanged, full amount on their exact date.
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE expense_type != 'MONTHLY' AND expense_date BETWEEN $1 AND $2`,
      [from, to]
    ),
    // MONTHLY — fetch every row whose calendar month could possibly overlap
    // [from, to] (a one-month pad on both sides is generous enough to catch
    // every real case; proratedMonthlyAmount does the exact overlap math),
    // then prorate in JS rather than in SQL, where this date arithmetic is
    // far easier to get right and to unit-test on its own.
    pool.query(
      `SELECT amount, expense_date FROM expenses
       WHERE expense_type = 'MONTHLY'
         AND expense_date >= ($1::date - INTERVAL '31 days')
         AND expense_date <= ($2::date + INTERVAL '31 days')`,
      [from, to]
    ),
  ]);
  const lumpTotal = Number(lumpSumResult.rows[0].total);
  const monthlyTotal = monthlyRowsResult.rows.reduce((sum: number, r: { amount: string; expense_date: string | Date }) => {
    return sum + proratedMonthlyAmount(toDateOnlyIso(r.expense_date), Number(r.amount), from, to);
  }, 0);
  return lumpTotal + monthlyTotal;
}

export async function sumExpensesForDate(date: string): Promise<number> {
  return sumExpensesForRange(date, date);
}
