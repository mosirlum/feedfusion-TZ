import * as growthRepo from '../db/growthRepo';
import * as expensesRepo from '../db/expensesRepo';
import { MonthMetrics, toMetrics } from './businessGrowthMonths.service';
import { pctChange } from './businessGrowthDetails.service';
import { addDaysIso, firstOfMonthOffset, monthKey, todayInTanzania } from '../utils/tzDate';

/**
 * Business Growth — monthly performance (2026-10-27, step 2 of the owner's
 * "comparison between months" request: "tujue kuwa tunapata faida au hasara
 * na tunaenda wapi"). The last six calendar months side by side, a plain
 * profit/loss verdict per month, and a rule-based "where are we heading".
 *
 * Definitions are the app's usual ones (see businessGrowthMonths.service.ts):
 * net profit = gross profit (sale_items cost snapshot) - expenses, with
 * MONTHLY expenses prorated by day inside their own calendar month.
 */

export const OVERVIEW_MONTHS = 6;
/** |net margin| under this % is called "break-even" rather than profit/loss. */
export const BREAK_EVEN_MARGIN_PCT = 1;
/** Net profit must move by more than this share of its own size to count as improving/declining. */
export const TREND_THRESHOLD = 0.05;

export type Verdict = 'profit' | 'loss' | 'breakeven' | 'no_data';

export interface OverviewMonth {
  /** 'YYYY-MM' */
  month: string;
  from: string;
  to: string;
  isPartial: boolean;
  metrics: MonthMetrics;
  /** Net profit as % of revenue (null when there was no revenue). */
  marginPct: number | null;
  verdict: Verdict;
}

export type TrajectoryStatus = 'improving' | 'steady' | 'declining' | 'not_enough_data';

export interface Trajectory {
  status: TrajectoryStatus;
  /** Complete months compared: the most recent ones vs the ones before them. */
  recentMonths: string[];
  earlierMonths: string[];
  recentAvgNetProfit: number | null;
  earlierAvgNetProfit: number | null;
  netProfitChangePct: number | null;
  recentAvgRevenue: number | null;
  earlierAvgRevenue: number | null;
  revenueChangePct: number | null;
}

export interface MonthlyOverview {
  asOf: string;
  months: OverviewMonth[];
  /** Latest COMPLETE month that had any activity (null if none yet). */
  lastFullMonth: string | null;
  trajectory: Trajectory;
  /** Net profit summed over the complete months shown, and how many were profit / loss. */
  completeMonthsTotal: { netProfit: number; profitMonths: number; lossMonths: number };
  /** Monthly costs recorded last month but not yet this month (current month's profit is overstated until added). */
  missingMonthlyExpenses: { month: string; categories: string[] } | null;
}

// --- pure helpers (exported for unit tests) ---------------------------------

export function verdictFor(m: MonthMetrics): { verdict: Verdict; marginPct: number | null } {
  if (m.revenue === 0 && m.expenses === 0 && m.grossProfit === 0) return { verdict: 'no_data', marginPct: null };
  const marginPct = m.revenue > 0 ? Math.round((m.netProfit / m.revenue) * 1000) / 10 : null;
  if (marginPct !== null && Math.abs(marginPct) < BREAK_EVEN_MARGIN_PCT) return { verdict: 'breakeven', marginPct };
  return { verdict: m.netProfit > 0 ? 'profit' : m.netProfit < 0 ? 'loss' : 'breakeven', marginPct };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Recent complete months vs the complete months before them. Only months
 * from the first one with sales count (the shop's history may be short), and
 * the split is: most recent ceil(n/2) (max 3) vs up to 3 before those.
 */
export function computeTrajectory(completeMonths: OverviewMonth[]): Trajectory {
  const firstActive = completeMonths.findIndex((m) => m.metrics.revenue > 0);
  const active = firstActive === -1 ? [] : completeMonths.slice(firstActive);
  const empty: Trajectory = {
    status: 'not_enough_data',
    recentMonths: [],
    earlierMonths: [],
    recentAvgNetProfit: null,
    earlierAvgNetProfit: null,
    netProfitChangePct: null,
    recentAvgRevenue: null,
    earlierAvgRevenue: null,
    revenueChangePct: null,
  };
  if (active.length < 2) return empty;

  const recentCount = Math.min(3, Math.ceil(active.length / 2));
  const recent = active.slice(-recentCount);
  const earlier = active.slice(Math.max(0, active.length - recentCount - 3), active.length - recentCount);

  const recentNet = avg(recent.map((m) => m.metrics.netProfit));
  const earlierNet = avg(earlier.map((m) => m.metrics.netProfit));
  const recentRev = avg(recent.map((m) => m.metrics.revenue));
  const earlierRev = avg(earlier.map((m) => m.metrics.revenue));

  const delta = recentNet - earlierNet;
  const threshold = TREND_THRESHOLD * Math.max(Math.abs(recentNet), Math.abs(earlierNet), 1);
  const status: TrajectoryStatus = delta > threshold ? 'improving' : delta < -threshold ? 'declining' : 'steady';

  return {
    status,
    recentMonths: recent.map((m) => m.month),
    earlierMonths: earlier.map((m) => m.month),
    recentAvgNetProfit: Math.round(recentNet),
    earlierAvgNetProfit: Math.round(earlierNet),
    netProfitChangePct: pctChange(recentNet, earlierNet),
    recentAvgRevenue: Math.round(recentRev),
    earlierAvgRevenue: Math.round(earlierRev),
    revenueChangePct: pctChange(recentRev, earlierRev),
  };
}

export function monthWindows(today: string, count: number = OVERVIEW_MONTHS) {
  return Array.from({ length: count }, (_, i) => {
    const from = firstOfMonthOffset(today, -(count - 1 - i));
    const end = addDaysIso(firstOfMonthOffset(from, 1), -1);
    return { month: monthKey(from), from, to: end > today ? today : end, isPartial: end > today };
  });
}

// --- service ------------------------------------------------------------------

export async function getMonthlyOverview(today: string = todayInTanzania()): Promise<MonthlyOverview> {
  const windows = monthWindows(today);
  const firstMonth = windows[0].from;
  const currentMonth = windows[windows.length - 1];
  const prev = windows[windows.length - 2];

  const [series, expenses, missing] = await Promise.all([
    growthRepo.monthlySalesSeries(firstMonth, currentMonth.from),
    expensesRepo.sumExpensesByWindows(windows.map((w) => ({ from: w.from, to: w.to }))),
    expensesRepo.missingMonthlyCategories(prev.from, prev.to, currentMonth.from, currentMonth.to),
  ]);
  const byMonth = new Map(series.map((r) => [r.month, r]));

  const months: OverviewMonth[] = windows.map((w, i) => {
    const row = byMonth.get(w.month) ?? { month: w.month, revenue: 0, sales_count: 0, gross_profit: 0, customers_served: 0, new_customers: 0 };
    const metrics = toMetrics(row, expenses[i]);
    return { ...w, metrics, ...verdictFor(metrics) };
  });

  const complete = months.filter((m) => !m.isPartial);
  const activeComplete = complete.filter((m) => m.verdict !== 'no_data');
  return {
    asOf: today,
    months,
    lastFullMonth: activeComplete.length ? activeComplete[activeComplete.length - 1].month : null,
    trajectory: computeTrajectory(complete),
    completeMonthsTotal: {
      netProfit: activeComplete.reduce((s, m) => s + m.metrics.netProfit, 0),
      profitMonths: activeComplete.filter((m) => m.verdict === 'profit').length,
      lossMonths: activeComplete.filter((m) => m.verdict === 'loss').length,
    },
    missingMonthlyExpenses: missing.length ? { month: currentMonth.month, categories: missing } : null,
  };
}
