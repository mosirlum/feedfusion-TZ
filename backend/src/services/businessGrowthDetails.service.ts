import * as growthRepo from '../db/growthRepo';
import * as reportsRepo from '../db/reportsRepo';
import * as inventoryService from './inventory.service';
import { addDaysIso, daysBetween, firstOfMonthOffset, mondayOnOrBefore, monthKey, todayInTanzania, toDateOnlyIso } from '../utils/tzDate';

/**
 * Business Growth — detail sections (2026-10-09, owner's request to extend
 * the page): slow-moving stock, reorder suggestions, weekly/monthly trend,
 * and top customers / debtors. A separate endpoint from the issue-card
 * analysis (businessGrowth.service.ts) on purpose: that response shape is
 * unchanged, and these heavier tables load independently so a slow query
 * here never blanks the advice cards.
 *
 * Rule-based and deterministic, like the rest of Business Growth — every
 * threshold is a named constant below so it can be tuned without hunting.
 */

// --- tunable thresholds ---------------------------------------------------
const VELOCITY_WINDOW_DAYS = 30; // how far back "recent sales speed" looks
const NEW_PRODUCT_GRACE_DAYS = 14; // don't call a just-added product "slow"
const SLOW_NO_SALE_DAYS = 30; // in stock but unsold this long = slow
const SLOW_COVER_DAYS = 90; // or: current stock would last longer than this
const REORDER_TARGET_COVER_DAYS = 14; // order enough to cover this many days
const REORDER_TRIGGER_COVER_DAYS = 10; // suggest ordering when cover drops below this
const REORDER_NOW_COVER_DAYS = 3; // ...and flag as urgent below this
const WEEKS_SHOWN = 12;
const MONTHS_SHOWN = 6;
const TOP_CUSTOMER_WINDOW_DAYS = 90;
const LIST_LIMIT = 8;

export interface SlowMovingItem {
  productId: number;
  name: string;
  unit: string | null;
  currentStock: number;
  /** Capital tied up at last purchase cost (null if never purchased). */
  stockValueCost: number | null;
  daysSinceLastSale: number | null; // null = never sold
  soldLast30d: number;
  /** How many days the current stock would last at the recent selling speed (null = no recent sales). */
  daysOfCover: number | null;
  reason: 'no_recent_sales' | 'overstocked';
}

export interface ReorderSuggestion {
  productId: number;
  name: string;
  unit: string | null;
  currentStock: number;
  minimumStock: number;
  avgDailySales: number;
  daysOfCover: number | null; // 0 when already out
  suggestedQty: number;
  estimatedCost: number | null;
  urgency: 'now' | 'soon';
}

export interface TrendPoint {
  /** Week: Monday 'YYYY-MM-DD'. Month: 'YYYY-MM'. */
  period: string;
  revenue: number;
  grossProfit: number;
  /** % change in revenue vs the previous period (null for the first period or when it was 0). */
  revenueChangePct: number | null;
  isPartial: boolean;
}

export interface CustomerRevenue {
  name: string;
  phone: string | null;
  salesCount: number;
  revenue: number;
}

export interface CustomerDebt {
  name: string;
  phone: string | null;
  invoices: number;
  balanceDue: number;
  overdueBalance: number;
  oldestDueDate: string | null;
}

export interface BusinessGrowthDetails {
  asOf: string;
  slowMoving: { items: SlowMovingItem[]; totalValueTiedUp: number; totalCount: number };
  reorder: { items: ReorderSuggestion[]; totalCount: number };
  trend: { weekly: TrendPoint[]; monthly: TrendPoint[] };
  customers: {
    windowDays: number;
    top: CustomerRevenue[];
    debts: { items: CustomerDebt[]; totalOutstanding: number; debtorCount: number };
  };
}

// --- pure helpers (exported for unit tests) ---------------------------------

export function pctChange(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Days of stock left at the current selling speed; null when nothing sold recently. */
export function daysOfCover(currentStock: number, soldQty: number, windowDays: number): number | null {
  if (!(soldQty > 0)) return null;
  const perDay = soldQty / windowDays;
  return Math.round((currentStock / perDay) * 10) / 10;
}

export function classifySlow(input: {
  currentStock: number;
  soldLast30d: number;
  daysSinceLastSale: number | null;
  daysSinceFirstStock: number | null;
}): SlowMovingItem['reason'] | null {
  if (input.currentStock <= 0) return null;
  // A product with under two weeks of history hasn't had a fair chance to sell.
  if (input.daysSinceFirstStock !== null && input.daysSinceFirstStock < NEW_PRODUCT_GRACE_DAYS) return null;
  if (input.soldLast30d <= 0 && (input.daysSinceLastSale === null || input.daysSinceLastSale >= SLOW_NO_SALE_DAYS)) {
    return 'no_recent_sales';
  }
  const cover = daysOfCover(input.currentStock, input.soldLast30d, VELOCITY_WINDOW_DAYS);
  if (cover !== null && cover > SLOW_COVER_DAYS) return 'overstocked';
  return null;
}

export function reorderSuggestion(input: {
  currentStock: number;
  minimumStock: number;
  soldLast30d: number;
}): { suggestedQty: number; urgency: 'now' | 'soon'; avgDailySales: number; cover: number | null } | null {
  // No recent sales → nothing to base a reorder on (slow-moving covers that case).
  if (!(input.soldLast30d > 0)) return null;
  const avgDaily = input.soldLast30d / VELOCITY_WINDOW_DAYS;
  const stock = Math.max(0, input.currentStock);
  const cover = stock / avgDaily;
  const belowMinimum = input.minimumStock > 0 && stock <= input.minimumStock;
  if (cover >= REORDER_TRIGGER_COVER_DAYS && !belowMinimum) return null;
  const suggestedQty = Math.max(1, Math.ceil(avgDaily * REORDER_TARGET_COVER_DAYS - stock));
  return {
    suggestedQty,
    urgency: stock <= 0 || cover < REORDER_NOW_COVER_DAYS ? 'now' : 'soon',
    avgDailySales: Math.round(avgDaily * 100) / 100,
    cover: Math.round(cover * 10) / 10,
  };
}

function withChange(points: Array<Omit<TrendPoint, 'revenueChangePct'>>): TrendPoint[] {
  return points.map((p, i) => ({
    ...p,
    // A partial (in-progress) period isn't comparable to a full one, so it gets no % change.
    revenueChangePct: i === 0 || p.isPartial ? null : pctChange(p.revenue, points[i - 1].revenue),
  }));
}

// --- main -------------------------------------------------------------------

export async function getBusinessGrowthDetails(): Promise<BusinessGrowthDetails> {
  const today = todayInTanzania();
  const velocityFrom = addDaysIso(today, -(VELOCITY_WINDOW_DAYS - 1));
  const weekStart = mondayOnOrBefore(today);
  const trendFrom = [addDaysIso(weekStart, -7 * (WEEKS_SHOWN - 1)), firstOfMonthOffset(today, -(MONTHS_SHOWN - 1))].sort()[0];

  const [inventory, velocity, daily, profit, topRows, debts] = await Promise.all([
    inventoryService.getInventory(),
    growthRepo.productVelocity(velocityFrom, today),
    reportsRepo.salesDailySeries(trendFrom, today),
    reportsRepo.profitDailySeries(trendFrom, today),
    growthRepo.topCustomers(addDaysIso(today, -(TOP_CUSTOMER_WINDOW_DAYS - 1)), today, LIST_LIMIT),
    growthRepo.customerDebts(LIST_LIMIT),
  ]);

  // ---- products: slow-moving + reorder ----
  const velocityById = new Map(velocity.map((v) => [v.product_id, v]));
  const slowAll: SlowMovingItem[] = [];
  const reorderAll: ReorderSuggestion[] = [];

  for (const row of inventory as any[]) {
    if (row.status === 'inactive') continue;
    const v = velocityById.get(row.id);
    const soldLast30d = v?.sold_qty ?? 0;
    const daysSinceLastSale = v?.last_sold_at ? daysBetween(toDateOnlyIso(v.last_sold_at), today) : null;
    const daysSinceFirstStock = v?.first_movement_at ? daysBetween(toDateOnlyIso(v.first_movement_at), today) : null;
    const currentStock = Number(row.current_stock);

    const reason = classifySlow({ currentStock, soldLast30d, daysSinceLastSale, daysSinceFirstStock });
    if (reason) {
      slowAll.push({
        productId: row.id,
        name: row.name,
        unit: row.unit ?? null,
        currentStock,
        stockValueCost: row.stock_value_cost ?? null,
        daysSinceLastSale,
        soldLast30d,
        daysOfCover: daysOfCover(currentStock, soldLast30d, VELOCITY_WINDOW_DAYS),
        reason,
      });
    }

    const reorder = reorderSuggestion({ currentStock, minimumStock: Number(row.minimum_stock ?? 0), soldLast30d });
    if (reorder) {
      const unitCost = row.last_unit_cost !== null && row.last_unit_cost !== undefined ? Number(row.last_unit_cost) : null;
      reorderAll.push({
        productId: row.id,
        name: row.name,
        unit: row.unit ?? null,
        currentStock: Math.max(0, currentStock),
        minimumStock: Number(row.minimum_stock ?? 0),
        avgDailySales: reorder.avgDailySales,
        daysOfCover: reorder.cover,
        suggestedQty: reorder.suggestedQty,
        estimatedCost: unitCost !== null ? Math.round(unitCost * reorder.suggestedQty) : null,
        urgency: reorder.urgency,
      });
    }
  }

  slowAll.sort((a, b) => (b.stockValueCost ?? 0) - (a.stockValueCost ?? 0));
  reorderAll.sort((a, b) => (a.urgency === b.urgency ? (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0) : a.urgency === 'now' ? -1 : 1));

  // ---- trend ----
  const revenueByDate = new Map<string, number>();
  for (const r of daily as Array<{ date: string | Date; revenue: string | number }>) revenueByDate.set(toDateOnlyIso(r.date), Number(r.revenue));
  const profitByDate = new Map<string, number>();
  for (const r of profit as Array<{ date: string | Date; gross_profit: string | number }>) profitByDate.set(toDateOnlyIso(r.date), Number(r.gross_profit));

  const sumRange = (map: Map<string, number>, fromIso: string, toIso: string) => {
    let sum = 0;
    for (let d = fromIso; d <= toIso; d = addDaysIso(d, 1)) sum += map.get(d) ?? 0;
    return sum;
  };

  const weekly = withChange(
    Array.from({ length: WEEKS_SHOWN }, (_, i) => {
      const start = addDaysIso(weekStart, -7 * (WEEKS_SHOWN - 1 - i));
      const end = addDaysIso(start, 6);
      return {
        period: start,
        revenue: sumRange(revenueByDate, start, end > today ? today : end),
        grossProfit: sumRange(profitByDate, start, end > today ? today : end),
        isPartial: end > today,
      };
    })
  );

  const monthly = withChange(
    Array.from({ length: MONTHS_SHOWN }, (_, i) => {
      const start = firstOfMonthOffset(today, -(MONTHS_SHOWN - 1 - i));
      const nextStart = firstOfMonthOffset(start, 1);
      const end = addDaysIso(nextStart, -1);
      const capped = end > today ? today : end;
      return {
        period: monthKey(start),
        revenue: sumRange(revenueByDate, start, capped),
        grossProfit: sumRange(profitByDate, start, capped),
        isPartial: end > today,
      };
    })
  );

  return {
    asOf: today,
    slowMoving: {
      items: slowAll.slice(0, LIST_LIMIT),
      totalValueTiedUp: Math.round(slowAll.reduce((sum, i) => sum + (i.stockValueCost ?? 0), 0)),
      totalCount: slowAll.length,
    },
    reorder: { items: reorderAll.slice(0, LIST_LIMIT), totalCount: reorderAll.length },
    trend: { weekly, monthly },
    customers: {
      windowDays: TOP_CUSTOMER_WINDOW_DAYS,
      top: topRows.map((r) => ({ name: r.name, phone: r.phone, salesCount: r.sales_count, revenue: r.revenue })),
      debts: {
        items: debts.rows.map((r) => ({
          name: r.name,
          phone: r.phone,
          invoices: r.invoices,
          balanceDue: r.balance_due,
          overdueBalance: r.overdue_balance,
          oldestDueDate: r.oldest_due_date ? toDateOnlyIso(r.oldest_due_date) : null,
        })),
        totalOutstanding: debts.totalOutstanding,
        debtorCount: debts.debtorCount,
      },
    },
  };
}
