import * as reportsService from './reports.service';
import * as inventoryService from './inventory.service';
import { getSettings } from './settings.service';

/**
 * Narrative Business Report (2026-09-13, CLAUDE.md #64) — replaces the idea
 * of "print the Reports dashboard as a PDF" (what #63/#63-follow-up spent a
 * whole session correctly paginating) with a genuinely different
 * deliverable. The owner's own words: printing the dashboard is like
 * submitting your raw meeting hint-notes as "the report" — what he actually
 * wants is the document a person writes AFTER reading those notes: an
 * intro, a narrative explanation of what happened and why, supporting
 * graphs, and closing insights. This module is that "person" — it reads
 * the same aggregated numbers `reports.service.ts` already computes for the
 * on-screen Sales tab (`getSalesOverview`) and turns them into English
 * sentences using fixed rules/thresholds, not a language model (the owner
 * explicitly chose the non-AI path over an AI-narrated option — see
 * decisions-log / this session's chat history — mainly to avoid the cost
 * and account-setup hassle of wiring up a paid Claude API key for
 * infrequent use).
 *
 * Two judgment calls made here without going back to the owner, since he
 * asked me to stop deliberating and start building (flagged per the
 * project's standing "flag judgment calls" instruction):
 *
 * 1. SCOPE: this MVP only narrates the Sales-tab data (`getSalesOverview` —
 *    revenue, transactions, discounts, voids, daily trend, revenue by
 *    category/staff, top products, cash counts, low stock). It does not yet
 *    narrate Purchases, Suppliers, or standalone Inventory movements — those
 *    aren't aggregated into one call anywhere yet the way Sales is, and
 *    doing them justice would mean either a second big feature or a much
 *    thinner report. Extending to those tabs is a natural, separate,
 *    follow-up piece of work.
 * 2. RANGE: named "Narrative Report" / route `/reports/narrative`, not
 *    "monthly narrative report" — even though the owner's own framing was
 *    "the report for this month," the underlying data source and the
 *    Reports page's own date picker (CLAUDE.md #62) already support
 *    Week/Month/Year/Custom, and there's no reason to hard-code this to
 *    calendar months only when the exact same rule-based narrative applies
 *    just as well to a week or a custom range. `periodLabel()` below
 *    auto-detects "this range is exactly one full calendar month" and
 *    labels it by month name (e.g. "September 2026") when true — the exact
 *    framing the owner asked for — and falls back to a plain date range
 *    label otherwise, so a Week or Year report still reads naturally.
 */

export interface NarrativeSection {
  key: string;
  heading: string;
  paragraphs: string[];
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface NarrativeReport {
  business: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    tin: string | null;
  };
  periodLabel: string;
  from: string;
  to: string;
  generatedAt: string;
  executiveSummary: string[];
  // KPI tiles (2026-09-13, CLAUDE.md #64 follow-up — the owner asked for
  // the PDF to "look like data analysis," not just paragraphs) — the same
  // four headline numbers the on-screen Sales tab's stat cards already
  // show, exposed here so pdfReport.service.ts can render its own small
  // dashboard-style tile row instead of leaving the reader to extract these
  // from the Executive Summary sentence.
  kpis: {
    totalRevenue: number;
    totalRevenueChangePct: number | null;
    transactionCount: number;
    transactionCountChangePct: number | null;
    totalDiscount: number;
    totalDiscountChangePct: number | null;
    voidedCount: number;
    voidedCountChangePct: number | null;
  };
  sections: NarrativeSection[];
  insights: string[];
  charts: {
    dailyRevenue: Array<{ date: string; revenue: number }>;
    revenueByCategory: ChartPoint[];
    revenueByStaff: ChartPoint[];
    topProducts: ChartPoint[];
  };
}

function tzs(n: number): string {
  const rounded = Math.round(n);
  return `TZS ${rounded.toLocaleString('en-TZ')}`;
}

function pctAbs(p: number): string {
  return `${Math.abs(p).toFixed(1)}%`;
}

function fmtDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value.length <= 10 ? `${value}T00:00:00Z` : value) : value;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function fmtDateShort(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value.length <= 10 ? `${value}T00:00:00Z` : value) : value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// See judgment call #2 above — labels a whole calendar month by name, and
// falls back to a plain "D Month – D Month" range for anything else (a
// week, a year, or a custom range).
function periodLabel(from: string, to: string): string {
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  const sameMonth = fromD.getUTCFullYear() === toD.getUTCFullYear() && fromD.getUTCMonth() === toD.getUTCMonth();
  const isMonthStart = fromD.getUTCDate() === 1;
  const lastDayOfMonth = new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth() + 1, 0)).getUTCDate();
  const isMonthEnd = toD.getUTCDate() === lastDayOfMonth;
  if (sameMonth && isMonthStart && isMonthEnd) {
    return fromD.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const sameYear = fromD.getUTCFullYear() === toD.getUTCFullYear();
  const isYearStart = isMonthStart && fromD.getUTCMonth() === 0;
  const isYearEnd = toD.getUTCMonth() === 11 && isMonthEnd;
  if (sameYear && isYearStart && isYearEnd) {
    return `${fromD.getUTCFullYear()}`;
  }
  return `${fmtDateShort(fromD)} – ${fmtDateShort(toD)}`;
}

function buildExecutiveSummary(
  o: Awaited<ReturnType<typeof reportsService.getSalesOverview>>,
  businessName: string,
  periodLbl: string,
  activeDays: number,
  totalDays: number,
  busiest: { date: string; revenue: number } | null
): string[] {
  const paras: string[] = [];
  const rev = o.current.totalRevenue;
  const revChange = o.changePct.totalRevenue;
  const trend =
    revChange === null
      ? 'there is no data from an equivalent prior period to compare against yet'
      : revChange >= 0
        ? `up ${pctAbs(revChange)} compared with the previous period of equal length`
        : `down ${pctAbs(revChange)} compared with the previous period of equal length`;

  paras.push(
    `This report covers ${businessName}'s trading activity for ${periodLbl}. ` +
      `The business recorded ${tzs(rev)} in total revenue across ${o.current.transactionCount} completed sale${
        o.current.transactionCount === 1 ? '' : 's'
      }, ${trend}.`
  );

  if (activeDays > 0) {
    paras.push(
      `Sales were recorded on ${activeDays} of the ${totalDays} day${totalDays === 1 ? '' : 's'} in this period` +
        (busiest ? `, with the busiest day being ${fmtDate(busiest.date)} at ${tzs(busiest.revenue)} in sales.` : '.')
    );
  } else {
    paras.push('No sales were recorded at all during this period.');
  }

  return paras;
}

function buildSalesPerformanceSection(
  o: Awaited<ReturnType<typeof reportsService.getSalesOverview>>
): NarrativeSection {
  const paras: string[] = [];
  const txChange = o.changePct.transactionCount;
  paras.push(
    `${o.current.transactionCount} sale${o.current.transactionCount === 1 ? ' was' : 's were'} completed for a combined total of ${tzs(
      o.current.totalRevenue
    )}` +
      (txChange === null
        ? '.'
        : `, ${txChange >= 0 ? 'an increase of' : 'a decrease of'} ${pctAbs(txChange)} in transaction count versus the previous period.`)
  );

  const grossBeforeDiscount = o.current.totalRevenue + o.current.totalDiscount;
  const discountShare = grossBeforeDiscount > 0 ? (o.current.totalDiscount / grossBeforeDiscount) * 100 : 0;
  if (o.current.totalDiscount > 0) {
    const discChange = o.changePct.totalDiscount;
    paras.push(
      `A total of ${tzs(o.current.totalDiscount)} was given out in discounts, ${discountShare.toFixed(1)}% of gross sales before discount` +
        (discChange === null ? '.' : `, ${discChange >= 0 ? 'up' : 'down'} ${pctAbs(discChange)} on the previous period.`)
    );
  } else {
    paras.push('No discounts were given during this period.');
  }

  if (o.current.voidedCount > 0) {
    const voidChange = o.changePct.voidedCount;
    paras.push(
      `${o.current.voidedCount} sale${o.current.voidedCount === 1 ? '' : 's'} ${o.current.voidedCount === 1 ? 'was' : 'were'} voided in this period` +
        (voidChange === null ? '.' : `, ${voidChange >= 0 ? 'up' : 'down'} ${pctAbs(voidChange)} on the previous period.`)
    );
  } else {
    paras.push('No sales were voided during this period.');
  }

  return { key: 'sales', heading: 'Sales Performance', paragraphs: paras };
}

function buildCategorySection(rows: Array<{ category_name: string; quantity_sold: string; revenue: string }>): NarrativeSection {
  if (rows.length === 0) {
    return { key: 'category', heading: 'Revenue by Category', paragraphs: ['No categorized sales were recorded in this period.'] };
  }
  const total = rows.reduce((sum, r) => sum + Number(r.revenue), 0);
  const top = rows[0];
  const topShare = total > 0 ? (Number(top.revenue) / total) * 100 : 0;
  const paras = [
    `${rows.length} product categor${rows.length === 1 ? 'y' : 'ies'} contributed to sales this period. ${top.category_name} led with ${tzs(
      Number(top.revenue)
    )} (${topShare.toFixed(1)}% of category-attributed revenue).`,
  ];
  if (rows.length > 1) {
    const others = rows
      .slice(1, 4)
      .map((r) => `${r.category_name} (${tzs(Number(r.revenue))})`)
      .join(', ');
    paras.push(`Other notable categories: ${others}.`);
  }
  return { key: 'category', heading: 'Revenue by Category', paragraphs: paras };
}

function buildTopProductsSection(
  rows: Array<{ product_name: string; unit: string | null; quantity_sold: string; revenue: string }>,
  totalQuantitySold: number
): NarrativeSection {
  if (rows.length === 0) {
    return { key: 'products', heading: 'Top Products', paragraphs: ['No product sales were recorded in this period.'] };
  }
  const list = rows
    .map((p, i) => `${i + 1}. ${p.product_name} — ${Number(p.quantity_sold)} ${p.unit ?? 'unit(s)'} sold, ${tzs(Number(p.revenue))} in revenue`)
    .join('; ');
  return {
    key: 'products',
    heading: 'Top Products',
    paragraphs: [`The top-selling products by revenue this period were: ${list}.`, `In total, ${totalQuantitySold} unit(s) were sold across all products.`],
  };
}

function buildStaffSection(rows: Array<{ user_name: string; transaction_count: number; revenue: string }>): NarrativeSection {
  if (rows.length === 0) {
    return { key: 'staff', heading: 'Staff Performance', paragraphs: ['No staff-attributed sales were recorded in this period.'] };
  }
  if (rows.length === 1) {
    return {
      key: 'staff',
      heading: 'Staff Performance',
      paragraphs: [
        `All sales in this period were served by ${rows[0].user_name}, totaling ${tzs(Number(rows[0].revenue))} across ${rows[0].transaction_count} transaction${
          rows[0].transaction_count === 1 ? '' : 's'
        }.`,
      ],
    };
  }
  const total = rows.reduce((sum, r) => sum + Number(r.revenue), 0);
  const top = rows[0];
  const topShare = total > 0 ? (Number(top.revenue) / total) * 100 : 0;
  const list = rows
    .map((r) => `${r.user_name} (${tzs(Number(r.revenue))}, ${r.transaction_count} sale${r.transaction_count === 1 ? '' : 's'})`)
    .join('; ');
  return {
    key: 'staff',
    heading: 'Staff Performance',
    paragraphs: [`Sales were served by ${rows.length} staff members: ${list}.`, `${top.user_name} led with ${topShare.toFixed(1)}% of total staff-attributed revenue.`],
  };
}

function buildCashSection(rows: Array<{ count_date: string | Date; expected_cash: string; actual_cash: string; difference: string; counted_by_name: string }>): NarrativeSection {
  if (rows.length === 0) {
    return { key: 'cash', heading: 'Cash Control', paragraphs: ['No cash counts were recorded during this period.'] };
  }
  const withDiff = rows.filter((r) => Number(r.difference) !== 0);
  const paras = [
    `${rows.length} cash count${rows.length === 1 ? ' was' : 's were'} recorded in this period` +
      (withDiff.length > 0
        ? `, of which ${withDiff.length} showed a variance between expected and actual cash.`
        : ', all matching the expected cash exactly.'),
  ];
  if (withDiff.length > 0) {
    const worst = [...withDiff].sort((a, b) => Math.abs(Number(b.difference)) - Math.abs(Number(a.difference)))[0];
    const diff = Number(worst.difference);
    paras.push(
      `The largest variance was ${tzs(Math.abs(diff))} ${diff < 0 ? 'short' : 'over'} on ${fmtDate(worst.count_date)}, counted by ${worst.counted_by_name}.`
    );
  }
  return { key: 'cash', heading: 'Cash Control', paragraphs: paras };
}

function buildLowStockSection(
  lowStock: Array<{ name: string; unit: string | null; current_stock: number; minimum_stock: number; status: string }>
): NarrativeSection {
  if (lowStock.length === 0) {
    return { key: 'stock', heading: 'Stock Levels', paragraphs: ['No products are currently low on stock or out of stock.'] };
  }
  const outOfStock = lowStock.filter((p) => p.status === 'OUT_OF_STOCK');
  const low = lowStock.filter((p) => p.status === 'LOW');
  const paras: string[] = [];
  if (outOfStock.length > 0) {
    const names = outOfStock.slice(0, 10).map((p) => p.name).join(', ');
    paras.push(`${outOfStock.length} product(s) are completely out of stock: ${names}${outOfStock.length > 10 ? ', and others' : ''}.`);
  }
  if (low.length > 0) {
    const names = low
      .slice(0, 10)
      .map((p) => `${p.name} (${p.current_stock} ${p.unit ?? ''} left)`.replace('  ', ' '))
      .join(', ');
    paras.push(`${low.length} product(s) are running low: ${names}${low.length > 10 ? ', and others' : ''}.`);
  }
  paras.push('Restocking these soon will help avoid turning away customers.');
  return { key: 'stock', heading: 'Stock Levels', paragraphs: paras };
}

function buildInsights(
  o: Awaited<ReturnType<typeof reportsService.getSalesOverview>>,
  activeDays: number,
  totalDays: number,
  busiest: { date: string; revenue: number } | null,
  lowStock: Array<{ name: string }>,
  categoryRows: Array<{ category_name: string; revenue: string }>,
  staffRows: Array<{ user_name: string; revenue: string }>
): string[] {
  const insights: string[] = [];
  const revChange = o.changePct.totalRevenue;

  if (revChange !== null && revChange <= -10) {
    insights.push(
      `Revenue declined ${pctAbs(revChange)} compared with the previous period — worth reviewing what changed (fewer customers, stock-outs, pricing, or competition).`
    );
  } else if (revChange !== null && revChange >= 10) {
    insights.push(`Revenue grew ${pctAbs(revChange)} compared with the previous period — worth noting what drove the increase so it can be repeated.`);
  }

  const grossBeforeDiscount = o.current.totalRevenue + o.current.totalDiscount;
  const discountShare = grossBeforeDiscount > 0 ? (o.current.totalDiscount / grossBeforeDiscount) * 100 : 0;
  if (discountShare >= 15) {
    insights.push(`Discounts made up ${discountShare.toFixed(1)}% of gross sales this period, which is high — worth reviewing discount approval rules.`);
  }

  const voidShare = o.current.transactionCount + o.current.voidedCount > 0 ? o.current.voidedCount / (o.current.transactionCount + o.current.voidedCount) : 0;
  if (o.current.voidedCount > 0 && voidShare >= 0.1) {
    insights.push(`${o.current.voidedCount} voided sale(s) is a relatively high share of total transactions — worth checking why sales are being voided.`);
  }

  if (busiest && o.current.totalRevenue > 0 && busiest.revenue / o.current.totalRevenue >= 0.4 && activeDays >= 5) {
    insights.push(
      `A large share of revenue (${((busiest.revenue / o.current.totalRevenue) * 100).toFixed(1)}%) came from a single day (${fmtDate(
        busiest.date
      )}) — sales are concentrated rather than steady across the period.`
    );
  }

  if (activeDays > 0 && totalDays > 0 && activeDays / totalDays < 0.5) {
    insights.push(
      `The shop only recorded sales on ${activeDays} of ${totalDays} days in this period — worth checking whether this reflects planned closures or missed sales opportunities.`
    );
  }

  if (lowStock.length > 0) {
    insights.push(`${lowStock.length} product(s) are low or out of stock — restocking them promptly could prevent lost sales.`);
  }

  const catTotal = categoryRows.reduce((sum, r) => sum + Number(r.revenue), 0);
  if (categoryRows.length > 0 && catTotal > 0) {
    const top = categoryRows[0];
    const share = Number(top.revenue) / catTotal;
    if (share >= 0.6) {
      insights.push(`${top.category_name} alone accounts for ${(share * 100).toFixed(1)}% of category revenue — the business is fairly concentrated in this category.`);
    }
  }

  const staffTotal = staffRows.reduce((sum, r) => sum + Number(r.revenue), 0);
  if (staffRows.length > 1 && staffTotal > 0) {
    const top = staffRows[0];
    const share = Number(top.revenue) / staffTotal;
    if (share >= 0.6) {
      insights.push(`${top.user_name} accounts for ${(share * 100).toFixed(1)}% of staff-attributed revenue — worth checking whether workload or shift coverage is balanced.`);
    }
  }

  if (insights.length === 0) {
    insights.push('No significant risks or opportunities stood out this period — performance looks steady.');
  }

  return insights;
}

export async function buildNarrativeReport(fromRaw?: string, toRaw?: string): Promise<NarrativeReport> {
  // getSalesOverview validates from/to itself and throws HttpError on bad
  // input (same as every other Reports endpoint) — if it resolves, fromRaw/
  // toRaw are guaranteed to be well-formed YYYY-MM-DD strings.
  const [overview, settings, lowStock] = await Promise.all([
    reportsService.getSalesOverview(fromRaw, toRaw),
    getSettings(),
    inventoryService.getLowStock(),
  ]);
  const from = fromRaw as string;
  const to = toRaw as string;

  const totalDays = overview.dailySeries.length;
  const activeDays = overview.dailySeries.filter((d) => d.revenue > 0).length;
  const busiest = overview.dailySeries.reduce<{ date: string; revenue: number } | null>(
    (best, d) => (!best || d.revenue > best.revenue ? { date: d.date, revenue: d.revenue } : best),
    null
  );

  const periodLbl = periodLabel(from, to);

  const sections: NarrativeSection[] = [
    buildSalesPerformanceSection(overview),
    buildCategorySection(overview.revenueByCategory),
    buildTopProductsSection(overview.topProducts, overview.totalQuantitySold),
    buildStaffSection(overview.revenueByStaff),
    buildCashSection(overview.cashHistory),
    buildLowStockSection(lowStock),
  ];

  return {
    business: {
      name: settings.business_name,
      address: settings.address ?? null,
      phone: settings.phone ?? null,
      email: settings.email ?? null,
      tin: settings.tin ?? null,
    },
    periodLabel: periodLbl,
    from,
    to,
    generatedAt: new Date().toISOString(),
    executiveSummary: buildExecutiveSummary(overview, settings.business_name, periodLbl, activeDays, totalDays, busiest),
    kpis: {
      totalRevenue: overview.current.totalRevenue,
      totalRevenueChangePct: overview.changePct.totalRevenue,
      transactionCount: overview.current.transactionCount,
      transactionCountChangePct: overview.changePct.transactionCount,
      totalDiscount: overview.current.totalDiscount,
      totalDiscountChangePct: overview.changePct.totalDiscount,
      voidedCount: overview.current.voidedCount,
      voidedCountChangePct: overview.changePct.voidedCount,
    },
    sections,
    insights: buildInsights(overview, activeDays, totalDays, busiest, lowStock, overview.revenueByCategory, overview.revenueByStaff),
    charts: {
      dailyRevenue: overview.dailySeries.map((d) => ({ date: d.date, revenue: d.revenue })),
      revenueByCategory: overview.revenueByCategory.map((r) => ({ label: r.category_name, value: Number(r.revenue) })),
      revenueByStaff: overview.revenueByStaff.map((r) => ({ label: r.user_name, value: Number(r.revenue) })),
      topProducts: overview.topProducts.map((p) => ({ label: p.product_name, value: Number(p.revenue) })),
    },
  };
}
