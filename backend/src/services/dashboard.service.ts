import * as reportsRepo from '../db/reportsRepo';
import * as expensesRepo from '../db/expensesRepo';
import * as inventoryService from './inventory.service';
import * as salesRepo from '../db/salesRepo';
import * as purchasesRepo from '../db/purchasesRepo';
import { pool } from '../db/pool';
import { pctChange } from '../utils/period';
import { HttpError } from '../middleware/errorHandler';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function sumPurchasesForDate(date: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total_cost), 0)::float AS total FROM purchases WHERE purchase_date::date = $1`,
    [date]
  );
  return Number(rows[0].total);
}

// Mirrors reportsRepo.salesDailySeries's own shape/convention (CLAUDE.md #41)
// so the dashboard's trend chart and Reports' own charts stay consistent.
async function purchasesDailySeries(from: string, to: string) {
  const { rows } = await pool.query(
    `SELECT purchase_date::date AS date, COALESCE(SUM(total_cost), 0)::float AS total
     FROM purchases
     WHERE purchase_date::date BETWEEN $1 AND $2
     GROUP BY purchase_date::date
     ORDER BY purchase_date::date ASC`,
    [from, to]
  );
  return rows;
}

/**
 * Section 25 + whole-app visual redesign (2026-09-12, CLAUDE.md #56/#57) —
 * today's sales, transactions, gross profit, expenses, estimated net,
 * low-stock alerts, top-selling products, PLUS the real aggregates needed
 * to match the owner-approved dashboard mockup without fabricating
 * anything: today's purchases total, current stock value, a stock-status
 * breakdown, a 7-day sales-vs-purchases trend, the 5 most recent
 * purchases, and real day-over-day % deltas for the 4 headline stats. All
 * in one call so the owner's landing screen doesn't need a dozen requests.
 *
 * Cash Control removed (2026-09-19, CLAUDE.md #69) — expectedCash/
 * cashCounted/cashCount/cashDiscrepancyAlert all depended on the Cash
 * Control page's manual daily count, which no longer exists anywhere in
 * the app; keeping those fields would have left a dashboard alert that
 * permanently says "cash hasn't been counted" with no way to ever clear
 * it. Removed together with the page itself rather than left half-wired.
 *
 * Profit & Loss visibility added same day (CLAUDE.md #69) — the owner's
 * own words: the dashboard only showed revenue-shaped numbers, and he
 * wants "jana nilipata faida kiasi gani" (yesterday's profit) and "wiki
 * iliyopita" (last week's) answered without leaving the dashboard.
 * Yesterday's figures were already being computed here (just discarded
 * after being used for the %-change deltas) — now returned directly. Last
 * 7 days reuses salesRepo.getSalesAggregate (already built for Sales
 * History's own stat cards) rather than a new query, plus the existing
 * expensesRepo.sumExpensesForRange.
 */
export async function getTodayDashboard(requesterId: number) {
  const date = todayIso();
  const yesterday = isoDaysAgo(1);
  const sevenDaysAgo = isoDaysAgo(6); // 7-day window inclusive of today

  const [
    summary,
    yesterdaySummary,
    expensesToday,
    expensesYesterday,
    lowStock,
    inventory,
    purchasesToday,
    purchasesYesterday,
    salesSeries,
    purchasesSeries,
    recentPurchases,
    last7DaysAggregate,
    last7DaysExpenses,
    outstandingDebt,
  ] = await Promise.all([
    reportsRepo.todaySummary(date),
    reportsRepo.todaySummary(yesterday),
    expensesRepo.sumExpensesForDate(date),
    expensesRepo.sumExpensesForDate(yesterday),
    inventoryService.getLowStock(),
    inventoryService.getInventory(),
    sumPurchasesForDate(date),
    sumPurchasesForDate(yesterday),
    reportsRepo.salesDailySeries(sevenDaysAgo, date),
    purchasesDailySeries(sevenDaysAgo, date),
    purchasesRepo.listPurchases(5),
    salesRepo.getSalesAggregate({ from: sevenDaysAgo, to: date, ownerView: true, requesterId }),
    expensesRepo.sumExpensesForRange(sevenDaysAgo, date),
    salesRepo.getOutstandingBalances(),
  ]);

  const estimatedNet = summary.grossProfit - expensesToday;
  const estimatedNetYesterday = yesterdaySummary.grossProfit - expensesYesterday;
  const last7DaysGrossProfit = Number(last7DaysAggregate.gross_profit);
  const last7DaysNet = last7DaysGrossProfit - last7DaysExpenses;

  // Fill every day in the 7-day window, even a quiet one with zero activity,
  // so the trend line never silently skips a day (same convention Reports'
  // own daily series already uses, CLAUDE.md #41).
  const dayMap = new Map<string, { sales: number; purchases: number }>();
  for (let i = 6; i >= 0; i--) {
    dayMap.set(isoDaysAgo(i), { sales: 0, purchases: 0 });
  }
  for (const r of salesSeries) {
    const key = new Date(r.date).toISOString().slice(0, 10);
    if (dayMap.has(key)) dayMap.get(key)!.sales = Number(r.revenue);
  }
  for (const r of purchasesSeries) {
    const key = new Date(r.date).toISOString().slice(0, 10);
    if (dayMap.has(key)) dayMap.get(key)!.purchases = Number(r.total);
  }
  const trend = Array.from(dayMap.entries()).map(([trendDate, v]) => ({
    date: trendDate,
    sales: v.sales,
    purchases: v.purchases,
  }));

  // Same fields getInventory() already computes for the Inventory page
  // (CLAUDE.md #32) — reused here rather than re-deriving stock value/status
  // with separate logic that could drift from what Inventory itself shows.
  const currentStockValue = inventory.reduce((sum, row: any) => sum + (row.stock_value_cost ?? 0), 0);
  const stockStatusCounts = inventory.reduce(
    (acc, row: any) => {
      if (row.status === 'OUT_OF_STOCK') acc.outOfStock += 1;
      else if (row.status === 'LOW') acc.lowStock += 1;
      else acc.inStock += 1;
      return acc;
    },
    { inStock: 0, lowStock: 0, outOfStock: 0 }
  );

  return {
    date,
    totalSales: summary.totalSales,
    transactionCount: summary.transactionCount,
    totalDiscount: summary.totalDiscount,
    grossProfit: summary.grossProfit,
    expenses: expensesToday,
    estimatedNet,
    lowStockAlert: lowStock.length > 0,
    lowStockCount: lowStock.length,
    lowStockProducts: lowStock.slice(0, 10),
    topProducts: summary.topProducts,

    // Added for the whole-app visual redesign (CLAUDE.md #56/#57) — every
    // one of these is real, queried data; nothing here is invented.
    totalPurchasesToday: purchasesToday,
    currentStockValue,
    totalProductsTracked: inventory.length,
    stockStatusCounts,
    trend,
    recentPurchases: recentPurchases.slice(0, 5),
    deltas: {
      totalSales: pctChange(summary.totalSales, yesterdaySummary.totalSales),
      grossProfit: pctChange(summary.grossProfit, yesterdaySummary.grossProfit),
      expenses: pctChange(expensesToday, expensesYesterday),
      estimatedNet: pctChange(estimatedNet, estimatedNetYesterday),
      totalPurchases: pctChange(purchasesToday, purchasesYesterday),
    },

    // Profit & Loss at a glance (CLAUDE.md #69) — "yesterday" is a single
    // calendar day; "last7Days" is the same rolling 7-day window already
    // used for the trend chart above, inclusive of today.
    profitAndLoss: {
      yesterday: {
        grossProfit: yesterdaySummary.grossProfit,
        expenses: expensesYesterday,
        netProfit: estimatedNetYesterday,
      },
      last7Days: {
        grossProfit: last7DaysGrossProfit,
        expenses: last7DaysExpenses,
        netProfit: last7DaysNet,
      },
    },

    // Outstanding Customer Debt (CLAUDE.md #69 follow-up) — see
    // salesRepo.getOutstandingBalances for why this is per-sale, oldest-
    // first, rather than grouped by customer.
    outstandingDebt,
  };
}

/**
 * Custom-range Profit & Loss (2026-09-19, CLAUDE.md #69 follow-up) — the
 * owner liked the fixed Yesterday/Last 7 Days cards but also wants an
 * occasional custom period, without a date picker sitting on the
 * dashboard permanently ("iwe hidden ... isije ikaharibu UI" — kept
 * behind a button on the frontend; this endpoint is what that button
 * calls). Same reuse as the fixed cards: salesRepo.getSalesAggregate for
 * gross profit, expensesRepo.sumExpensesForRange for expenses.
 */
export async function getProfitAndLossForRange(fromRaw: string | undefined, toRaw: string | undefined, requesterId: number) {
  if (!fromRaw || !toRaw || !DATE_RE.test(fromRaw) || !DATE_RE.test(toRaw)) {
    throw new HttpError(400, 'FROM_AND_TO_DATES_REQUIRED');
  }
  if (fromRaw > toRaw) {
    throw new HttpError(400, 'FROM_MUST_NOT_BE_AFTER_TO');
  }

  const [aggregate, expenses] = await Promise.all([
    salesRepo.getSalesAggregate({ from: fromRaw, to: toRaw, ownerView: true, requesterId }),
    expensesRepo.sumExpensesForRange(fromRaw, toRaw),
  ]);
  const grossProfit = Number(aggregate.gross_profit);

  return {
    from: fromRaw,
    to: toRaw,
    grossProfit,
    expenses,
    netProfit: grossProfit - expenses,
  };
}
