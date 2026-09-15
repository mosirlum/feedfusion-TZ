import * as reportsRepo from '../db/reportsRepo';
import * as expensesRepo from '../db/expensesRepo';
import * as cashCountsRepo from '../db/cashCountsRepo';
import * as inventoryService from './inventory.service';
import * as salesRepo from '../db/salesRepo';
import * as purchasesRepo from '../db/purchasesRepo';
import { pool } from '../db/pool';
import { pctChange } from '../utils/period';

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
 * expected cash, low-stock alerts, discrepancy alerts, cash-not-counted
 * alert, top-selling products, PLUS the real aggregates needed to match the
 * owner-approved dashboard mockup without fabricating anything: today's
 * purchases total, current stock value, a stock-status breakdown, a 7-day
 * sales-vs-purchases trend, the 5 most recent purchases, and real
 * day-over-day % deltas for the 4 headline stats. All in one call so the
 * owner's landing screen doesn't need a dozen requests.
 */
export async function getTodayDashboard() {
  const date = todayIso();
  const yesterday = isoDaysAgo(1);
  const sevenDaysAgo = isoDaysAgo(6); // 7-day window inclusive of today

  const [
    summary,
    yesterdaySummary,
    expensesToday,
    expensesYesterday,
    cashCount,
    lowStock,
    inventory,
    cashReceivedToday,
    purchasesToday,
    purchasesYesterday,
    salesSeries,
    purchasesSeries,
    recentPurchases,
  ] = await Promise.all([
    reportsRepo.todaySummary(date),
    reportsRepo.todaySummary(yesterday),
    expensesRepo.sumExpensesForDate(date),
    expensesRepo.sumExpensesForDate(yesterday),
    cashCountsRepo.findCashCountForDate(date),
    inventoryService.getLowStock(),
    inventoryService.getInventory(),
    salesRepo.sumCashReceivedForDate(date),
    sumPurchasesForDate(date),
    sumPurchasesForDate(yesterday),
    reportsRepo.salesDailySeries(sevenDaysAgo, date),
    purchasesDailySeries(sevenDaysAgo, date),
    purchasesRepo.listPurchases(5),
  ]);

  const estimatedNet = summary.grossProfit - expensesToday;
  const estimatedNetYesterday = yesterdaySummary.grossProfit - expensesYesterday;

  // Fixed 2026-09-12 (CLAUDE.md #57): this used to be `summary.totalSales`
  // (the full sale total, regardless of payment method or how much was
  // actually collected). Since credit sales / multiple payment methods
  // (CLAUDE.md #50), that overstates cash-in-the-till whenever a sale is
  // PARTIAL or paid by bank/mobile money — the same bug Cash Control itself
  // never had, because it already used sumCashReceivedForDate. Aligning the
  // dashboard's "Expected Cash Today" with that same real figure.
  const expectedCash = cashReceivedToday;

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
    expectedCash,
    cashCounted: cashCount !== null,
    cashCount: cashCount ?? null,
    cashDiscrepancyAlert: cashCount !== null && Number(cashCount.difference) !== 0,
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
  };
}
