import { pool } from './pool';

export async function insertCashCount(input: {
  countDate: string;
  expectedCash: number;
  actualCash: number;
  difference: number;
  notes: string | null;
  countedBy: number;
}) {
  const { rows } = await pool.query(
    `INSERT INTO cash_counts (count_date, expected_cash, actual_cash, difference, notes, counted_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [input.countDate, input.expectedCash, input.actualCash, input.difference, input.notes, input.countedBy]
  );
  return rows[0];
}

export async function findCashCountForDate(countDate: string) {
  const { rows } = await pool.query('SELECT * FROM cash_counts WHERE count_date = $1', [countDate]);
  return rows[0] ?? null;
}

/**
 * Cash Control Center redesign (2026-09-12, CLAUDE.md #39) — backs the
 * "Actual Count Recorded" / "Variance" stat cards, which the mockup shows
 * reading from whatever the most recent count happens to be (its own
 * caption reads "Last count: Today, 4:32 PM"), not necessarily today's.
 */
export async function getLatestCount() {
  const { rows } = await pool.query(
    `SELECT cc.*, u.name AS counted_by_name
     FROM cash_counts cc
     JOIN users u ON u.id = cc.counted_by
     ORDER BY cc.created_at DESC
     LIMIT 1`
  );
  return rows[0] ?? null;
}

/**
 * "Counts This Week" is every count row (including recounts of the same
 * date — CLAUDE.md #10 already established recounts create new rows, not
 * replacements) dated within the current ISO week (Monday-start). Whether
 * today itself has been counted yet backs the "N pending (today)" hint —
 * counting per day was never made mandatory (#10), so "pending" only ever
 * applies to today, never to past days.
 */
export async function getWeekCounts() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE count_date >= date_trunc('week', CURRENT_DATE)::date) AS counts_this_week,
       COUNT(*) FILTER (WHERE count_date = CURRENT_DATE) AS counts_today
     FROM cash_counts`
  );
  const r = rows[0];
  return { countsThisWeek: Number(r.counts_this_week), countsToday: Number(r.counts_today) };
}

export async function listCashCounts(filters: { from?: string; to?: string }) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.from) {
    values.push(filters.from);
    conditions.push(`cc.count_date >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`cc.count_date <= $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT cc.*, u.name AS counted_by_name
     FROM cash_counts cc
     JOIN users u ON u.id = cc.counted_by
     ${where}
     ORDER BY cc.count_date DESC
     LIMIT 500`,
    values
  );
  return rows;
}
