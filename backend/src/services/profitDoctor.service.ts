import { HttpError } from '../middleware/errorHandler';
import * as profitRepo from '../db/profitDoctorRepo';
import * as reportsRepo from '../db/reportsRepo';
import * as salesRepo from '../db/salesRepo';
import * as expensesRepo from '../db/expensesRepo';
import { previousPeriodRange } from '../utils/period';

/**
 * Profit Doctor (2026-11-09, CLAUDE.md #95). The owner makes big sales but
 * keeps little profit, and asked the SYSTEM (which has the numbers) to explain
 * why and say what to do. Rule-based, like the narrative report: every finding
 * is computed from real rows, says what is happening, why it matters, what to
 * do, and (where it can be estimated) how much money is at stake.
 * Estimates assume volume stays the same — the text says so.
 */
export const TARGET_MARGIN_PCT = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`;
const roundUp500 = (n: number) => Math.ceil(n / 500) * 500;

export type DoctorFinding = {
  id: string;
  severity: 'critical' | 'warning' | 'info' | 'good';
  title: string;
  what: string;
  why: string;
  actions: string[];
  impactTzs: number | null;
  evidence: Array<{ label: string; value: string }>;
};

export async function getProfitDoctor(fromRaw?: string, toRaw?: string) {
  if (!fromRaw || !toRaw || !DATE_RE.test(fromRaw) || !DATE_RE.test(toRaw)) throw new HttpError(400, 'FROM_AND_TO_DATES_REQUIRED');
  if (fromRaw > toRaw) throw new HttpError(400, 'FROM_MUST_NOT_BE_AFTER_TO');
  const from = fromRaw;
  const to = toRaw;
  const { prevFrom, prevTo } = previousPeriodRange(from, to);

  const [totals, profitAgg, products, expenses, expCats, prevCats, below, custDisc, losses, overdue] = await Promise.all([
    reportsRepo.salesTotals(from, to),
    salesRepo.getSalesAggregate({ from, to, ownerView: true, requesterId: 0 }),
    profitRepo.productEconomics(from, to),
    expensesRepo.sumExpensesForRange(from, to),
    expensesRepo.expensesByCategoryForRange(from, to),
    expensesRepo.expensesByCategoryForRange(prevFrom, prevTo),
    profitRepo.belowCostSales(from, to),
    profitRepo.customerDiscounts(from, to),
    profitRepo.stockLosses(from, to),
    profitRepo.overdueReceivables(),
  ]);

  const revenue = Number(totals.total_revenue);
  const discount = Number(totals.total_discount);
  const gross = Number(profitAgg.gross_profit);
  const cogs = revenue - gross;
  const net = gross - expenses;
  const T = TARGET_MARGIN_PCT;
  const grossMargin = revenue > 0 ? (gross / revenue) * 100 : 0;

  const summary = {
    revenue, cogs, gross, grossMarginPct: grossMargin, discount, expenses, net,
    netMarginPct: revenue > 0 ? (net / revenue) * 100 : 0,
    expensesPctOfGross: gross > 0 ? (expenses / gross) * 100 : null,
    per100: revenue > 0 ? { products: (cogs / revenue) * 100, expenses: (expenses / revenue) * 100, profit: (net / revenue) * 100 } : { products: 0, expenses: 0, profit: 0 },
    oneMarginPointTzs: revenue / 100,
  };

  // ---- per product ------------------------------------------------------
  const rows = products
    .filter((p) => p.revenue > 0 && p.qty > 0)
    .map((p) => {
      const avgPrice = p.revenue / p.qty;
      const avgCost = p.cost / p.qty;
      const costNow = p.latest_cost && p.latest_cost > 0 ? p.latest_cost : avgCost;
      const margin = ((p.revenue - p.cost) / p.revenue) * 100;
      const suggested = roundUp500(costNow / (1 - T / 100));
      const gain = margin < T ? p.qty * Math.max(0, suggested - avgPrice) : 0;
      const costRisePct = avgCost > 0 ? ((costNow - avgCost) / avgCost) * 100 : 0;
      const marginAtListPrice = p.active_price && p.active_price > 0 ? ((p.active_price - costNow) / p.active_price) * 100 : null;
      return {
        productId: p.product_id, name: p.product_name, unit: p.unit, qty: p.qty, revenue: p.revenue,
        sharePct: revenue > 0 ? (p.revenue / revenue) * 100 : 0,
        profit: p.revenue - p.cost, marginPct: margin, avgPrice, avgCost, costNow, suggestedPrice: suggested,
        gain, costRisePct, listPrice: p.active_price, marginAtListPricePct: marginAtListPrice,
      };
    });
  const belowTarget = rows.filter((r) => r.marginPct < T);
  const fixList = belowTarget.filter((r) => r.sharePct >= 2 && r.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 8);
  const priceGain = fixList.reduce((s, r) => s + r.gain, 0);

  const findings: DoctorFinding[] = [];

  if (revenue > 0 && grossMargin < 8) {
    findings.push({
      id: 'thin_margin', severity: grossMargin < 5 ? 'critical' : 'warning',
      title: `You keep only ${pct(grossMargin)} of each sale after product cost`,
      what: `Of every TZS 100 you sell, about TZS ${Math.round(100 - grossMargin)} goes straight to paying for the goods and only TZS ${Math.round(grossMargin)} is left to pay all expenses and become your profit.`,
      why: `Feed is a high-volume, low-margin business, so the margin per bag decides everything. Each 1% of margin is worth ${tzs(summary.oneMarginPointTzs)} on your sales of ${tzs(revenue)} for this period. Cutting expenses cannot fix a margin this thin.`,
      actions: [
        `Aim for a margin of at least ${T}% on bulk and wholesale items and 12–15% on retail.`,
        'Fix the products listed under "Prices to correct" first: they are where the margin is lost.',
        'Ask your supplier for a better buying price: a volume discount, a price for paying cash, or a quote from a second supplier.',
      ],
      impactTzs: null, // the money is counted once, in the product price fix below
      evidence: [
        { label: 'Gross margin now', value: pct(grossMargin) },
        { label: 'Target', value: `${T}%` },
        { label: 'Worth per 1% of margin', value: tzs(summary.oneMarginPointTzs) },
      ],
    });
  }

  if (fixList.length > 0) {
    findings.push({
      id: 'price_fix', severity: fixList.some((r) => r.marginPct < 3) ? 'critical' : 'warning',
      title: `${fixList.length} product${fixList.length === 1 ? '' : 's'} sell below a ${T}% margin`,
      what: fixList.slice(0, 3).map((r) => `${r.name} (${pct(r.marginPct)}, ${pct(r.sharePct)} of your sales)`).join('; ') + '.',
      why: 'These are products you sell a lot of, so even a small price correction adds a lot of profit, while a price war on them costs you the most.',
      actions: [
        'Raise the selling price to the suggested price in the table below (it gives a 10% margin on the latest buying cost). Do it in Products → Price Proposals.',
        'If a competitor forces the price down, negotiate the buying price instead, or sell fewer bags of it and push higher-margin products.',
        'Do the fastest-selling product first, in small steps if you worry about customers.',
      ],
      impactTzs: priceGain,
      evidence: fixList.slice(0, 5).map((r) => ({ label: r.name, value: `${tzs(r.avgPrice)} → ${tzs(r.suggestedPrice)} per ${r.unit}` })),
    });
  }

  const costRise = rows.filter((r) => r.costRisePct >= 2 && r.sharePct >= 2 && r.marginAtListPricePct !== null && r.marginAtListPricePct < T)
    .sort((a, b) => b.costRisePct - a.costRisePct).slice(0, 5);
  if (costRise.length > 0) {
    findings.push({
      id: 'cost_rise', severity: costRise.some((r) => (r.marginAtListPricePct ?? 0) < 3) ? 'critical' : 'warning',
      title: `Buying cost went up on ${costRise.length} product${costRise.length === 1 ? '' : 's'} and your price did not follow`,
      what: costRise.map((r) => `${r.name}: cost +${pct(r.costRisePct)}, margin at today's selling price is now ${pct(r.marginAtListPricePct ?? 0)}`).join('; ') + '.',
      why: 'Your latest purchase cost more than the stock you sold in this period. Until the selling price is raised, every new bag you sell earns less than the old ones did.',
      actions: [
        'Raise the selling price of these products now, before the older cheaper stock runs out.',
        'Check with your supplier whether the increase is permanent, and compare with another supplier.',
      ],
      impactTzs: null,
      evidence: costRise.map((r) => ({ label: r.name, value: `cost ${tzs(r.avgCost)} → ${tzs(r.costNow)} · list price ${r.listPrice ? tzs(r.listPrice) : 'not set'}` })),
    });
  }

  const lowRevShare = belowTarget.reduce((s, r) => s + r.revenue, 0);
  const lowProfitShare = belowTarget.reduce((s, r) => s + r.profit, 0);
  if (revenue > 0 && gross > 0 && (lowRevShare / revenue) * 100 >= 50) {
    findings.push({
      id: 'mix', severity: 'info',
      title: `${pct((lowRevShare / revenue) * 100)} of your sales come from products that earn under ${T}%`,
      what: `Those products bring ${pct((lowRevShare / revenue) * 100)} of the sales but only ${pct((lowProfitShare / gross) * 100)} of the gross profit.`,
      why: 'A shop can look busy and still earn little when most of the volume is in the lowest-margin products.',
      actions: [
        'Rank products by profit per bag, not by sales, and tell your sellers which ones to recommend first (premixes, concentrates, supplements, medicines usually earn more).',
        'Keep the low-margin staples (customers expect them) but do not discount them.',
      ],
      impactTzs: null,
      evidence: [],
    });
  }

  const discountPct = revenue + discount > 0 ? (discount / (revenue + discount)) * 100 : 0;
  if (discountPct >= 1.5) {
    const risky = custDisc.filter((c) => c.revenue > 0 && (c.gross_profit / c.revenue) * 100 < 3);
    findings.push({
      id: 'discounts', severity: discountPct >= 4 || risky.length > 0 ? 'critical' : 'warning',
      title: `Discounts took ${tzs(discount)} (${pct(discountPct)} of sales) straight out of your profit`,
      what: custDisc.slice(0, 3).map((c) => `${c.customer}: discount ${tzs(c.discount)}, margin left ${pct(c.revenue > 0 ? (c.gross_profit / c.revenue) * 100 : 0)}`).join('; ') + '.',
      why: 'A discount has no cost price to hide behind: every shilling given is a shilling less profit. When the margin is only a few percent, a 2–3% discount can wipe it out.',
      actions: [
        'Set a maximum discount per bag, and require a reason and the owner\'s approval above it.',
        'Review the customers listed: if a customer\'s margin after discount is under 3%, give the discount only for bigger quantities or for paying cash.',
        'Ask: did the discount really win a sale you would have lost?',
      ],
      impactTzs: discount / 2,
      evidence: custDisc.map((c) => ({ label: c.customer, value: `discount ${tzs(c.discount)} on sales ${tzs(c.revenue)}` })),
    });
  }

  if (below.lines > 0) {
    findings.push({
      id: 'below_cost', severity: 'critical',
      title: `${below.lines} sale line${below.lines === 1 ? ' was' : 's were'} sold below cost`,
      what: `You lost ${tzs(below.loss)} on items sold for less than they cost you.`,
      why: 'Selling below cost loses money on every unit. It is usually a wrong price on the POS, a forgotten price update, or too big a discount.',
      actions: [
        'Open Reports → Discounts and Sales History for the period and find those lines.',
        'Fix the product price, and lower the discount limit for sellers who did it.',
      ],
      impactTzs: below.loss,
      evidence: [],
    });
  }

  const lossValue = losses.reduce((s, r) => s + r.value, 0);
  if (lossValue > 0 && (gross <= 0 || lossValue / gross >= 0.01)) {
    findings.push({
      id: 'stock_loss', severity: gross > 0 && lossValue / gross >= 0.1 ? 'critical' : 'warning',
      title: `Missing stock cost you about ${tzs(lossValue)}`,
      what: losses.slice(0, 3).map((r) => `${r.product_name}: ${Math.round(r.units)} units (${tzs(r.value)})`).join('; ') + '.',
      why: 'Every bag taken off the stock by a correction, damage or loss has to be paid for from your profit. Common causes: bags short in weight, rats, damp, expiry, miscounts.',
      actions: [
        'Do a stock count on your five best-selling products every week and investigate each gap the same day.',
        'Check in Audit Log who made these adjustments and why.',
        'Check bags on arrival (count and weight) and store off the floor and away from damp.',
      ],
      impactTzs: lossValue,
      evidence: losses.slice(0, 5).map((r) => ({ label: r.product_name, value: `${Math.round(r.units)} units · ${tzs(r.value)}` })),
    });
  }

  const prevMap = new Map(prevCats.map((c) => [c.category, c.amount]));
  const jumps = expCats.filter((c) => {
    const before = prevMap.get(c.category) ?? 0;
    return before > 0 && c.amount >= expenses * 0.05 && c.amount >= before * 1.3;
  });
  const expShare = gross > 0 ? (expenses / gross) * 100 : null;
  if (expenses > 0 && ((expShare !== null && expShare >= 50) || jumps.length > 0 || gross <= 0)) {
    const top = expCats[0];
    findings.push({
      id: 'expenses', severity: (expShare ?? 100) >= 90 ? 'critical' : 'warning',
      title: expShare !== null ? `Expenses take ${pct(expShare)} of your gross profit` : 'There is no gross profit to pay expenses from',
      what: [top ? `Biggest: ${top.category} (${tzs(top.amount)}, ${pct((top.amount / expenses) * 100)} of expenses).` : '', jumps.length ? `Up sharply from the previous period: ${jumps.map((c) => `${c.category} (${tzs(prevMap.get(c.category) ?? 0)} → ${tzs(c.amount)})`).join(', ')}.` : ''].filter(Boolean).join(' '),
      why: 'Expenses are paid from gross profit. When they eat more than half of it, little is left, and one bad week turns the month into a loss.',
      actions: [
        'Look at the biggest category first (often transport): combine deliveries, load vehicles full, compare quotes.',
        'Check every expense that jumped: is it one-off or a new habit?',
        'Make sure every expense is recorded, because missing expenses make profit look better than it is.',
      ],
      impactTzs: null,
      evidence: expCats.slice(0, 5).map((c) => ({ label: c.category, value: `${tzs(c.amount)}${prevMap.get(c.category) ? ` (before: ${tzs(prevMap.get(c.category) ?? 0)})` : ''}` })),
    });
  }

  if (overdue.overdue_amount > 0) {
    findings.push({
      id: 'receivables', severity: 'warning',
      title: `${tzs(overdue.overdue_amount)} is overdue from ${overdue.overdue_count} customer sale${overdue.overdue_count === 1 ? '' : 's'}`,
      what: 'These credit sales are counted as sales and profit, but the money has not come in.',
      why: 'Profit on paper does not pay suppliers or salaries. The longer a debt is overdue, the less likely it is paid, and an unpaid debt becomes a loss.',
      actions: [
        'Call the overdue customers this week (Dashboard → Money owed lists them, oldest first).',
        'Stop new credit for customers who are overdue, and set a credit limit and due date for everyone.',
        'Ask for a deposit on large credit sales.',
      ],
      impactTzs: null,
      evidence: [{ label: 'Overdue', value: tzs(overdue.overdue_amount) }],
    });
  }

  const order = { critical: 0, warning: 1, info: 2, good: 3 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (b.impactTzs ?? 0) - (a.impactTzs ?? 0));
  if (revenue > 0 && !findings.some((f) => f.severity === 'critical' || f.severity === 'warning')) {
    findings.push({
      id: 'healthy', severity: 'good',
      title: 'Your profit looks healthy for this period',
      what: `You keep ${pct(grossMargin)} after product cost and expenses use ${expShare === null ? 'all' : pct(expShare)} of gross profit.`,
      why: 'Margin, discounts and expenses are all within a safe range.',
      actions: ['Keep watching the margin of each product when buying prices change.'],
      impactTzs: null, evidence: [],
    });
  }

  const potentialTzs = priceGain + (findings.find((f) => f.id === 'discounts')?.impactTzs ?? 0) + below.loss + lossValue;

  return {
    period: { from, to },
    targetMarginPct: T,
    summary,
    findings,
    potentialTzs,
    products: rows.sort((a, b) => b.gain - a.gain || a.marginPct - b.marginPct).slice(0, 10),
    assumption: 'Estimates assume you sell the same quantities after the changes.',
  };
}
