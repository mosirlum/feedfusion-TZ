import { HttpError } from '../middleware/errorHandler';
import * as reportsRepo from '../db/reportsRepo';
import * as inventoryService from './inventory.service';
import * as salesRepo from '../db/salesRepo';
import { previousPeriodRange, pctChange } from '../utils/period';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireDateRange(from?: string, to?: string): { from: string; to: string } {
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new HttpError(400, 'FROM_AND_TO_DATES_REQUIRED');
  }
  if (from > to) {
    throw new HttpError(400, 'FROM_MUST_NOT_BE_AFTER_TO');
  }
  return { from, to };
}

export async function getSalesReport(fromRaw?: string, toRaw?: string) {
  const { from, to } = requireDateRange(fromRaw, toRaw);
  return reportsRepo.salesReport(from, to);
}

export async function getProductSalesReport(fromRaw?: string, toRaw?: string) {
  const { from, to } = requireDateRange(fromRaw, toRaw);
  return reportsRepo.productSalesReport(from, to);
}

export function getStockReport() {
  return inventoryService.getInventory();
}

export function getLowStockReport() {
  return inventoryService.getLowStock();
}

export async function getDiscountsReport(fromRaw?: string, toRaw?: string, userId?: number) {
  const { from, to } = requireDateRange(fromRaw, toRaw);
  return reportsRepo.discountsReport(from, to, userId);
}

export async function getUsersReport(fromRaw?: string, toRaw?: string) {
  const { from, to } = requireDateRange(fromRaw, toRaw);
  return reportsRepo.usersActivityReport(from, to);
}

/**
 * Reports "Sales" tab redesign (2026-09-12, CLAUDE.md #41) — one aggregator
 * endpoint backing the stat cards (with real "vs previous period of equal
 * length" trends, same helper as Sales History's — CLAUDE.md #34), the
 * daily chart, the two donuts, the Top 5 list, and the raw numbers the
 * frontend turns into "Quick Insights" text. Kept as one endpoint rather
 * than five separate ones since every piece here shares the same
 * `from`/`to` and is meant to render together on one screen.
 *
 * Cash Count History card removed (2026-09-19, CLAUDE.md #69) along with
 * the rest of Cash Control. Gross Profit added the same day — the owner's
 * complaint that this report "gives only revenue" — reusing
 * salesRepo.getSalesAggregate (built for Sales History's stat cards)
 * rather than a new query; ownerView is always true here since this
 * endpoint is owner-only (see reports.routes.ts).
 */
export async function getSalesOverview(fromRaw?: string, toRaw?: string, requesterId?: number) {
  const { from, to } = requireDateRange(fromRaw, toRaw);
  const { prevFrom, prevTo } = previousPeriodRange(from, to);

  const [current, previous, dailyRows, profitDailyRows, revenueByCategory, revenueByStaff, topProductsAll, lowStock, profitAggregate, prevProfitAggregate] =
    await Promise.all([
      reportsRepo.salesTotals(from, to),
      reportsRepo.salesTotals(prevFrom, prevTo),
      reportsRepo.salesDailySeries(from, to),
      reportsRepo.profitDailySeries(from, to),
      reportsRepo.revenueByCategory(from, to),
      reportsRepo.revenueByStaff(from, to),
      reportsRepo.productSalesReport(from, to),
      inventoryService.getLowStock(),
      salesRepo.getSalesAggregate({ from, to, ownerView: true, requesterId: requesterId ?? 0 }),
      salesRepo.getSalesAggregate({ from: prevFrom, to: prevTo, ownerView: true, requesterId: requesterId ?? 0 }),
    ]);

  // Fill gaps so a quiet day shows as zero, not a missing point that would
  // otherwise silently compress the chart's date axis.
  const byDate = new Map<string, { revenue: number; transactions: number; discount: number; voided: number }>();
  for (const r of dailyRows) {
    const key = new Date(r.date).toISOString().slice(0, 10);
    byDate.set(key, {
      revenue: Number(r.revenue),
      transactions: Number(r.transactions),
      discount: Number(r.discount),
      voided: Number(r.voided),
    });
  }
  const profitByDate = new Map<string, number>();
  for (const r of profitDailyRows) {
    profitByDate.set(new Date(r.date).toISOString().slice(0, 10), Number(r.gross_profit));
  }
  const dailySeries: Array<{ date: string; revenue: number; transactions: number; discount: number; voided: number; grossProfit: number }> = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const entry = byDate.get(key);
    dailySeries.push({
      date: key,
      revenue: entry?.revenue ?? 0,
      transactions: entry?.transactions ?? 0,
      discount: entry?.discount ?? 0,
      voided: entry?.voided ?? 0,
      grossProfit: profitByDate.get(key) ?? 0,
    });
  }

  const totalRevenue = Number(current.total_revenue);
  const transactionCount = Number(current.transaction_count);
  const totalDiscount = Number(current.total_discount);
  const voidedCount = Number(current.voided_count);
  const grossProfit = Number(profitAggregate.gross_profit);
  const totalQuantitySold = topProductsAll.reduce((sum: number, p: { quantity_sold: string }) => sum + Number(p.quantity_sold), 0);

  return {
    current: { totalRevenue, transactionCount, totalDiscount, voidedCount, grossProfit },
    changePct: {
      totalRevenue: pctChange(totalRevenue, Number(previous.total_revenue)),
      transactionCount: pctChange(transactionCount, Number(previous.transaction_count)),
      totalDiscount: pctChange(totalDiscount, Number(previous.total_discount)),
      voidedCount: pctChange(voidedCount, Number(previous.voided_count)),
      grossProfit: pctChange(grossProfit, Number(prevProfitAggregate.gross_profit)),
    },
    dailySeries,
    revenueByCategory,
    revenueByStaff,
    topProducts: topProductsAll.slice(0, 5),
    totalQuantitySold,
    lowStockCount: lowStock.length,
  };
}

/**
 * Purchase Costs report (2026-09-12, CLAUDE.md #40) — combines the two
 * places purchasing-related overhead can land (additional cost lines on a
 * purchase, and PER_PURCHASE expenses for incidental non-invoice costs)
 * into one "how much did purchasing cost me beyond the goods themselves"
 * total for a chosen period. Confirmed with the owner: this total is
 * overhead only — it does NOT include the goods subtotal itself (that's
 * already visible on Purchases/Suppliers), and it is never meant to be
 * added into Net Profit, which already accounts for additional-cost-line
 * spend through COGS (see purchase_additional_cost_lines' own comment).
 */
export async function getPurchaseCostsReport(fromRaw?: string, toRaw?: string) {
  const { from, to } = requireDateRange(fromRaw, toRaw);
  const report = await reportsRepo.purchaseCostsReport(from, to);
  const totalAdditionalCosts = Number(report.summary.total_additional_costs);
  const totalPerPurchaseExpenses = report.perPurchaseExpenses.reduce(
    (sum: number, e: { amount: string }) => sum + Number(e.amount),
    0
  );
  return {
    ...report,
    summary: {
      purchaseCount: Number(report.summary.purchase_count),
      totalGoodsValue: Number(report.summary.total_goods_value),
      totalAdditionalCosts,
      totalPerPurchaseExpenses,
      combinedOverhead: totalAdditionalCosts + totalPerPurchaseExpenses,
    },
  };
}
