/**
 * Shared "vs previous period of equal length" helpers (extracted 2026-09-12,
 * CLAUDE.md #41, from sales.service.ts's getSalesStats — CLAUDE.md #34 —
 * which introduced this pattern for Sales History). A Sep 1-11 selection
 * compares against Aug 21-31, generalizing the this-month-vs-last-month
 * pattern first used on Suppliers (CLAUDE.md #30) to an arbitrary range.
 * Used by both sales.service.ts and reports.service.ts so the two places
 * this comparison happens can't drift apart.
 */
export function previousPeriodRange(from: string, to: string): { prevFrom: string; prevTo: string } {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const lengthDays = Math.round((toDate.getTime() - fromDate.getTime()) / dayMs) + 1;
  const prevTo = new Date(fromDate.getTime() - dayMs);
  const prevFrom = new Date(prevTo.getTime() - (lengthDays - 1) * dayMs);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { prevFrom: iso(prevFrom), prevTo: iso(prevTo) };
}

// When there's no activity at all in the previous period, the change is
// `null` (a real "nothing to compare against"), never a fabricated 0% or ±∞.
export function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}
