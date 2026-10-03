import * as reportsRepo from '../db/reportsRepo';
import * as salesRepo from '../db/salesRepo';
import * as inventoryService from './inventory.service';

/**
 * Business Growth (2026-10-03, owner's request) — "naomba tuiweke ambayo ni
 * business growth... system inafanya analysis kweny kila issue na ina
 * advice... ili mteja asije kuona aingiz faida yote na kufunga biashara"
 * (an analysis + advice page across every issue, so the client doesn't
 * conclude they're making no profit and close the business). A genuinely
 * open-ended ask — three real design decisions were put to the owner
 * before writing any code (AskUserQuestion), and the owner picked the
 * "Recommended" option on all three:
 *
 *   1. Advice engine: rule-based (deterministic, free, instant — same
 *      pattern as the Reports page's own "Quick Insights" and the
 *      narrative PDF, CLAUDE.md #64) rather than an LLM call. Simpler,
 *      cheaper, and consistent with the rest of the app, at the cost of
 *      the advice being templated rather than freely generated.
 *   2. "Expected" revenue: no targets/goals feature exists anywhere in
 *      this system, so rather than build one, the system computes its own
 *      "a normal week looks like this" baseline from the shop's own
 *      recent history (see weekBaseline() below) — zero setup required,
 *      but a brand-new shop with under 2 weeks of history won't have a
 *      reliable baseline yet (handled explicitly as 'no_baseline', never
 *      a fabricated comparison).
 *   3. Placement: a new top-level page (not a Reports tab) — see
 *      businessGrowth.routes.ts, navConfig.ts, BusinessGrowthPage.tsx.
 *
 * Scope for this first version (flagged, not exhaustive — "kila issue"
 * literally is open-ended): six rule categories chosen because they
 * directly answer what the owner asked for — is revenue on pace this
 * week, why might it be slow (stockouts on sellers, dead stock tying up
 * capital), and two early-warning signs (overdue customer debt, rising
 * discounts eating into margin, and the margin itself trending down).
 * Each rule is independent and the Issue[] shape is designed so more can
 * be added later without touching the others.
 */

const TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Dar_es_Salaam — fixed UTC+3, no DST

// This runs on a server (Vercel), whose own process timezone is UTC, NOT
// Tanzania's — unlike the browser-side fix already applied to
// frontend/src/lib/format.ts's todayIso() (CLAUDE.md #71), simply reading
// new Date()'s *local* getFullYear/getMonth/getDate here would be a no-op
// (the server's "local" timezone already IS UTC), so it would NOT actually
// fix anything. Instead: shift the current instant forward by the fixed
// +3h offset, then read its UTC fields — equivalent to reading Tanzania's
// wall-clock date directly, regardless of what timezone the server process
// itself happens to be running in.
function todayInTanzania(): string {
  const shifted = new Date(Date.now() + TZ_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

// Pure calendar-date math from here down — every function takes/returns
// 'YYYY-MM-DD' strings and uses UTC-anchored Date objects purely as a
// calendar calculator (Date.UTC, getUTCDay, etc.), never touching "now" or
// any timezone again. This keeps the one timezone-sensitive conversion
// (todayInTanzania, above) isolated to a single, obviously-correct spot.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

// Monday-start week, same convention as frontend/src/lib/format.ts's
// currentWeekRange() (CLAUDE.md #62).
function mondayOnOrBefore(iso: string): string {
  const dow = weekdayOf(iso);
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return addDaysIso(iso, -diffToMonday);
}

function toDateOnlyIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export type IssueSeverity = 'critical' | 'warning' | 'info' | 'positive';
export type IssueCategory = 'revenue' | 'stock' | 'debt' | 'pricing' | 'margin';

export interface GrowthIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  detail: string;
  advice: string;
}

export interface BusinessGrowthAnalysis {
  asOf: string;
  week: {
    start: string;
    daysElapsed: number;
    revenueToDate: number;
    expectedToDate: number | null;
    pctOfExpected: number | null;
    baselineWeeksUsed: number;
    status: 'no_baseline' | 'ahead' | 'on_track' | 'behind' | 'critical';
  };
  weeklyTrend: Array<{ weekStart: string; revenue: number; isPartial: boolean }>;
  issues: GrowthIssue[];
}

const MAX_BASELINE_WEEKS = 8;
const TREND_WEEKS = 10; // slightly more than the baseline window so the chart shows a little more history than the number itself uses

export async function getBusinessGrowthAnalysis(): Promise<BusinessGrowthAnalysis> {
  const today = todayInTanzania();
  const weekStart = mondayOnOrBefore(today);
  const daysElapsed = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86400000) + 1;

  // Fetch enough daily history to cover the trend chart's window plus the
  // baseline weeks, in one query.
  const historyFrom = addDaysIso(weekStart, -7 * TREND_WEEKS);
  const [dailyRows, productSales30d, profitRows30d, inventory, outstanding] = await Promise.all([
    reportsRepo.salesDailySeries(historyFrom, today),
    reportsRepo.productSalesReport(addDaysIso(today, -29), today),
    reportsRepo.profitDailySeries(addDaysIso(today, -29), today),
    inventoryService.getInventory(),
    salesRepo.getOutstandingBalances(),
  ]);

  const revenueByDate = new Map<string, number>();
  const discountByDate = new Map<string, number>();
  for (const r of dailyRows as Array<{ date: string | Date; revenue: number; discount: number }>) {
    const key = toDateOnlyIso(r.date);
    revenueByDate.set(key, Number(r.revenue));
    discountByDate.set(key, Number(r.discount));
  }

  function sumRevenue(fromIso: string, days: number): number {
    let sum = 0;
    for (let i = 0; i < days; i++) sum += revenueByDate.get(addDaysIso(fromIso, i)) ?? 0;
    return sum;
  }
  function sumDiscount(fromIso: string, days: number): number {
    let sum = 0;
    for (let i = 0; i < days; i++) sum += discountByDate.get(addDaysIso(fromIso, i)) ?? 0;
    return sum;
  }

  // Current week's revenue so far (Monday..today).
  const revenueToDate = sumRevenue(weekStart, daysElapsed);

  // Baseline: up to MAX_BASELINE_WEEKS complete weeks strictly before this
  // one, each summed only through the SAME day-of-week offset as today —
  // comparing a partial week (e.g. Mon-Wed) only against other weeks'
  // Mon-Wed, never against a baseline week's full 7 days, which would make
  // every week look "behind" just because it isn't over yet.
  const baselineToDateSums: number[] = [];
  for (let w = 1; w <= MAX_BASELINE_WEEKS; w++) {
    const bWeekStart = addDaysIso(weekStart, -7 * w);
    if (bWeekStart < historyFrom) break;
    baselineToDateSums.push(sumRevenue(bWeekStart, daysElapsed));
  }
  const baselineWeeksUsed = baselineToDateSums.length;
  const expectedToDate = baselineWeeksUsed > 0 ? baselineToDateSums.reduce((a, b) => a + b, 0) / baselineWeeksUsed : null;
  const pctOfExpected = expectedToDate && expectedToDate > 0 ? (revenueToDate / expectedToDate) * 100 : null;

  let status: BusinessGrowthAnalysis['week']['status'] = 'no_baseline';
  // Require at least 2 complete prior weeks before trusting a comparison —
  // one week alone is too noisy (a single unusually slow/busy week) to
  // call a reliable "normal."
  if (baselineWeeksUsed >= 2 && expectedToDate !== null && expectedToDate > 0) {
    const ratio = revenueToDate / expectedToDate;
    if (ratio >= 1.1) status = 'ahead';
    else if (ratio >= 0.85) status = 'on_track';
    else if (ratio >= 0.6) status = 'behind';
    else status = 'critical';
  }

  // Trend chart: full-week totals for every complete week in the window,
  // plus the current (partial) week so the chart doesn't just stop short.
  const weeklyTrend: BusinessGrowthAnalysis['weeklyTrend'] = [];
  for (let w = TREND_WEEKS; w >= 1; w--) {
    const wStart = addDaysIso(weekStart, -7 * w);
    if (wStart < historyFrom) continue;
    weeklyTrend.push({ weekStart: wStart, revenue: sumRevenue(wStart, 7), isPartial: false });
  }
  weeklyTrend.push({ weekStart, revenue: revenueToDate, isPartial: true });

  const issues: GrowthIssue[] = [];

  // --- Rule 1: revenue pace vs baseline ---------------------------------
  if (status === 'critical' || status === 'behind') {
    const shortfallPct = expectedToDate ? Math.round(100 - (revenueToDate / expectedToDate) * 100) : 0;
    issues.push({
      id: 'revenue-behind',
      severity: status === 'critical' ? 'critical' : 'warning',
      category: 'revenue',
      title: `Sales are ${shortfallPct}% behind a normal week`,
      detail: `So far this week (${daysElapsed} day${daysElapsed === 1 ? '' : 's'} in), revenue is behind the ${baselineWeeksUsed}-week average for the same days.`,
      advice: 'Check the Stock and Pricing issues below first — a stocked-out top seller or a stale price is often the direct cause. If nothing stands out, consider a short promotion on this week\'s slow movers to bring customers back in.',
    });
  } else if (status === 'ahead') {
    issues.push({
      id: 'revenue-ahead',
      severity: 'positive',
      category: 'revenue',
      title: `Sales are ahead of a normal week`,
      detail: `Revenue so far this week is running ahead of the ${baselineWeeksUsed}-week average for the same days — keep doing what's working.`,
      advice: 'Make sure fast-selling stock gets reordered promptly so this pace doesn\'t stall on a stockout.',
    });
  } else if (status === 'no_baseline') {
    issues.push({
      id: 'revenue-no-baseline',
      severity: 'info',
      category: 'revenue',
      title: 'Still building a baseline',
      detail: `Not enough history yet (${baselineWeeksUsed} complete week${baselineWeeksUsed === 1 ? '' : 's'} on record) to say what a "normal" week looks like.`,
      advice: 'This will fill in automatically after a couple more weeks of trading — no action needed.',
    });
  }

  // --- Rule 2: stockouts/low stock on recent top sellers -----------------
  const inventoryByProductId = new Map(inventory.map((row: any) => [row.id, row]));
  const topSellers30d = [...(productSales30d as Array<{ product_id: number; product_name: string; quantity_sold: string; revenue: string }>)]
    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
    .slice(0, 5);
  for (const p of topSellers30d) {
    const stockRow = inventoryByProductId.get(p.product_id);
    if (!stockRow) continue;
    if (stockRow.status === 'OUT_OF_STOCK') {
      issues.push({
        id: `stockout-${p.product_id}`,
        severity: 'critical',
        category: 'stock',
        title: `${p.product_name} is out of stock — one of your best sellers`,
        detail: `Sold ${p.quantity_sold} ${stockRow.unit ?? ''} in the last 30 days, but current stock is 0. Every day it stays empty is lost revenue on a product customers already want.`,
        advice: 'Restock this as soon as possible — it has proven demand, so this is likely the single fastest way to recover lost sales.',
      });
    } else if (stockRow.status === 'LOW') {
      issues.push({
        id: `lowstock-${p.product_id}`,
        severity: 'warning',
        category: 'stock',
        title: `${p.product_name} is running low`,
        detail: `A top seller (${p.quantity_sold} ${stockRow.unit ?? ''} sold in the last 30 days) is now below its minimum stock level.`,
        advice: 'Reorder soon so it doesn\'t go out of stock while demand is still strong.',
      });
    }
  }

  // --- Rule 3: dead / slow-moving stock -----------------------------------
  const soldProductIds = new Set((productSales30d as Array<{ product_id: number }>).map((p) => p.product_id));
  const deadStock = inventory
    .filter((row: any) => row.current_stock > 0 && !soldProductIds.has(row.id) && row.stock_value_cost != null)
    .sort((a: any, b: any) => (b.stock_value_cost ?? 0) - (a.stock_value_cost ?? 0))
    .slice(0, 5);
  if (deadStock.length > 0) {
    const tiedUpValue = deadStock.reduce((sum: number, row: any) => sum + (row.stock_value_cost ?? 0), 0);
    issues.push({
      id: 'dead-stock',
      severity: 'warning',
      category: 'stock',
      title: `${deadStock.length} product${deadStock.length === 1 ? '' : 's'} haven't sold in 30 days`,
      detail: `${deadStock.map((r: any) => r.name).join(', ')} — together tying up roughly ${Math.round(tiedUpValue).toLocaleString()} TZS in stock that isn't moving.`,
      advice: 'Consider a discount, a bundle with a fast seller, or a visible display spot to clear this stock and free up that cash.',
    });
  }

  // --- Rule 4: overdue customer debt --------------------------------------
  if (outstanding.overdueCount > 0) {
    const weeklyBaseline = expectedToDate ?? revenueToDate;
    const severe = weeklyBaseline > 0 && outstanding.totalOutstanding > weeklyBaseline * 0.5;
    issues.push({
      id: 'overdue-debt',
      severity: severe ? 'critical' : 'warning',
      category: 'debt',
      title: `${outstanding.overdueCount} customer${outstanding.overdueCount === 1 ? '' : 's'} overdue on credit`,
      detail: `${Math.round(outstanding.totalOutstanding).toLocaleString()} TZS is owed across ${outstanding.debtorCount} customer${outstanding.debtorCount === 1 ? '' : 's'} on credit, ${outstanding.overdueCount} past their due date.`,
      advice: 'Follow up on the overdue accounts first (see Dashboard → Outstanding Customer Debt) — this is cash the business has already earned but can\'t yet use.',
    });
  }

  // --- Rule 5 & 6: discount rate and margin trend vs baseline -------------
  if (baselineWeeksUsed >= 2) {
    const currentDiscount = sumDiscount(weekStart, daysElapsed);
    const currentDiscountRate = revenueToDate > 0 ? currentDiscount / (revenueToDate + currentDiscount) : 0;
    let baselineDiscountSum = 0;
    let baselineRevenueSum = 0;
    for (let w = 1; w <= baselineWeeksUsed; w++) {
      const bWeekStart = addDaysIso(weekStart, -7 * w);
      baselineDiscountSum += sumDiscount(bWeekStart, daysElapsed);
      baselineRevenueSum += sumRevenue(bWeekStart, daysElapsed);
    }
    const baselineDiscountRate = baselineRevenueSum + baselineDiscountSum > 0 ? baselineDiscountSum / (baselineRevenueSum + baselineDiscountSum) : 0;
    if (currentDiscountRate - baselineDiscountRate >= 0.05 && currentDiscount > 0) {
      issues.push({
        id: 'discount-rising',
        severity: 'info',
        category: 'pricing',
        title: 'Discounts are higher than usual this week',
        detail: `About ${Math.round(currentDiscountRate * 100)}% of gross sales is being discounted, versus the usual ${Math.round(baselineDiscountRate * 100)}%.`,
        advice: 'Worth checking why — is it deliberate (clearing dead stock, a promotion) or are prices being negotiated down more than usual?',
      });
    }

    const profitByDate = new Map<string, number>();
    for (const r of profitRows30d as Array<{ date: string | Date; gross_profit: string }>) {
      profitByDate.set(toDateOnlyIso(r.date), Number(r.gross_profit));
    }
    const revenue30d = sumRevenue(addDaysIso(today, -29), 30);
    const profit30d = [...profitByDate.values()].reduce((a, b) => a + b, 0);
    const margin30d = revenue30d > 0 ? profit30d / revenue30d : null;
    if (margin30d !== null && margin30d < 0.1) {
      issues.push({
        id: 'margin-thin',
        severity: margin30d < 0 ? 'critical' : 'warning',
        category: 'margin',
        title: margin30d < 0 ? 'Selling at a loss over the last 30 days' : 'Gross margin is thin over the last 30 days',
        detail: `Gross profit margin over the last 30 days is about ${Math.round(margin30d * 100)}% of revenue.`,
        advice: margin30d < 0
          ? 'Costs are exceeding selling prices on average — review supplier prices and selling prices together before this continues.'
          : 'A thin margin leaves little room for expenses. Review whether selling prices still reflect current purchase costs.',
      });
    }
  }

  if (issues.length === 0) {
    issues.push({
      id: 'all-clear',
      severity: 'positive',
      category: 'revenue',
      title: 'No issues flagged right now',
      detail: 'Revenue is on pace, stock looks healthy, and there\'s no overdue debt or margin concern at the moment.',
      advice: 'Keep monitoring week to week — this page updates automatically as new data comes in.',
    });
  }

  return {
    asOf: today,
    week: { start: weekStart, daysElapsed, revenueToDate, expectedToDate, pctOfExpected, baselineWeeksUsed, status },
    weeklyTrend,
    issues,
  };
}
