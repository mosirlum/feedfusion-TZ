import * as growthRepo from '../db/growthRepo';
import * as expensesRepo from '../db/expensesRepo';
import { pctChange } from './businessGrowthDetails.service';
import { addDaysIso, daysBetween, firstOfMonthOffset, monthKey, todayInTanzania } from '../utils/tzDate';

/**
 * Business Growth — month-vs-month comparison (2026-10-26, owner's request:
 * "comparison between months"). Step 1: this month so far vs the same days of
 * last month (like-for-like — a half-finished month is never set against a
 * whole one), with last month's full totals alongside for reference.
 *
 * Definitions match the rest of the app: revenue = SUM(total) of COMPLETED
 * sales; gross profit from the sale_items cost snapshot; expenses via
 * `sumExpensesForRange` (MONTHLY expenses prorated by day, the same function
 * the dashboard's profit & loss uses); net profit = gross profit - expenses.
 */

export interface MonthMetrics {
  revenue: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  salesCount: number;
  /** Average sale value (null when there were no sales). */
  avgSale: number | null;
  customersServed: number;
  newCustomers: number;
}

export interface MonthChanges {
  revenue: number | null;
  grossProfit: number | null;
  expenses: number | null;
  netProfit: number | null;
  salesCount: number | null;
  avgSale: number | null;
  customersServed: number | null;
  newCustomers: number | null;
}

export interface MonthWindow {
  /** 'YYYY-MM' */
  month: string;
  from: string;
  to: string;
}

export interface MonthComparison {
  asOf: string;
  current: MonthWindow & { daysElapsed: number; daysInMonth: number; isPartial: boolean; metrics: MonthMetrics };
  /** Last month, same number of days as `current` has run (the like-for-like baseline). */
  previousSamePeriod: MonthWindow & { isFullMonth: boolean; metrics: MonthMetrics };
  /** Last month in full, for reference. */
  previousFull: MonthWindow & { metrics: MonthMetrics };
  /** `current` vs `previousSamePeriod`, in %. null = no baseline to compare with. */
  changes: MonthChanges;
}

// --- pure helpers (exported for unit tests) ---------------------------------

export function buildMonthWindows(today: string) {
  const curFrom = firstOfMonthOffset(today, 0);
  const nextFrom = firstOfMonthOffset(today, 1);
  const prevFrom = firstOfMonthOffset(today, -1);
  const prevTo = addDaysIso(curFrom, -1);
  const daysElapsed = daysBetween(curFrom, today) + 1;
  const daysInMonth = daysBetween(curFrom, nextFrom);
  const prevDays = daysBetween(prevFrom, curFrom);
  // e.g. 31 Oct vs September (30 days): the baseline is simply all of September.
  const prevSameTo = addDaysIso(prevFrom, Math.min(daysElapsed, prevDays) - 1);
  return {
    current: { month: monthKey(curFrom), from: curFrom, to: today, daysElapsed, daysInMonth, isPartial: daysElapsed < daysInMonth },
    previousSamePeriod: { month: monthKey(prevFrom), from: prevFrom, to: prevSameTo, isFullMonth: prevSameTo === prevTo },
    previousFull: { month: monthKey(prevFrom), from: prevFrom, to: prevTo },
  };
}

export function toMetrics(
  row: { revenue: number; sales_count: number; gross_profit: number; customers_served: number; new_customers: number },
  expenses: number
): MonthMetrics {
  const revenue = Math.round(Number(row.revenue));
  const grossProfit = Math.round(Number(row.gross_profit));
  const exp = Math.round(Number(expenses));
  const salesCount = Number(row.sales_count);
  return {
    revenue,
    grossProfit,
    expenses: exp,
    netProfit: grossProfit - exp,
    salesCount,
    avgSale: salesCount > 0 ? Math.round(revenue / salesCount) : null,
    customersServed: Number(row.customers_served),
    newCustomers: Number(row.new_customers),
  };
}

export function buildChanges(current: MonthMetrics, baseline: MonthMetrics): MonthChanges {
  const pct = (a: number | null, b: number | null) => (a === null || b === null ? null : pctChange(a, b));
  return {
    revenue: pct(current.revenue, baseline.revenue),
    grossProfit: pct(current.grossProfit, baseline.grossProfit),
    expenses: pct(current.expenses, baseline.expenses),
    netProfit: pct(current.netProfit, baseline.netProfit),
    salesCount: pct(current.salesCount, baseline.salesCount),
    avgSale: pct(current.avgSale, baseline.avgSale),
    customersServed: pct(current.customersServed, baseline.customersServed),
    newCustomers: pct(current.newCustomers, baseline.newCustomers),
  };
}

async function metricsForRange(from: string, to: string): Promise<MonthMetrics> {
  const [row, expenses] = await Promise.all([growthRepo.rangeMetrics(from, to), expensesRepo.sumExpensesForRange(from, to)]);
  return toMetrics(row, expenses);
}

export async function getMonthComparison(today: string = todayInTanzania()): Promise<MonthComparison> {
  const w = buildMonthWindows(today);
  // When the baseline IS the full previous month (end of a long month), don't query it twice.
  const [current, previousSame, previousFullRaw] = await Promise.all([
    metricsForRange(w.current.from, w.current.to),
    metricsForRange(w.previousSamePeriod.from, w.previousSamePeriod.to),
    w.previousSamePeriod.isFullMonth ? Promise.resolve(null) : metricsForRange(w.previousFull.from, w.previousFull.to),
  ]);
  const previousFull = previousFullRaw ?? previousSame;

  return {
    asOf: today,
    current: { ...w.current, metrics: current },
    previousSamePeriod: { ...w.previousSamePeriod, metrics: previousSame },
    previousFull: { ...w.previousFull, metrics: previousFull },
    changes: buildChanges(current, previousSame),
  };
}
