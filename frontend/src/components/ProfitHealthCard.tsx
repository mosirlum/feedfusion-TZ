import { CSSProperties } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { SalesOverviewReport } from '../types';
import { tzs } from '../lib/format';
import { Card } from './ui';

/**
 * "Why is my profit small?" (2026-11-09, CLAUDE.md #94) — the owner makes big
 * sales but keeps little profit and asked the system to explain it. Takes the
 * Sales overview the Reports tab already loads (same numbers as the Net Profit
 * card, nothing recomputed differently) and answers in plain words: where each
 * TZS 100 of sales went, the biggest expenses, the thinnest-margin products,
 * and the main reasons, worst first.
 */
const dly = (ms: number): CSSProperties => ({ ['--d' as string]: `${ms}ms` });
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`;

type Finding = { tone: 'bad' | 'warn'; title: string; detail: string };

export function ProfitHealthCard({ data, periodLabel }: { data: SalesOverviewReport; periodLabel?: string }) {
  const { totalRevenue: revenue, grossProfit: gross, expenses, netProfit: net, totalDiscount: discount } = data.current;
  if (!(revenue > 0)) {
    return (
      <Card className="p-5">
        <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Why is my profit small?</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-[#97a49b]">No sales in this period yet, so there is nothing to explain.</p>
      </Card>
    );
  }

  const cogs = revenue - gross;
  const per100 = (n: number) => (n / revenue) * 100;
  const grossMargin = per100(gross);
  const expOfGross = gross > 0 ? (expenses / gross) * 100 : null;
  const discountPct = (discount / (revenue + discount)) * 100;
  const cats = data.expensesByCategory ?? [];
  const low = data.lowMarginProducts ?? [];
  const topCat = cats[0];

  const findings: Finding[] = [];
  if (net < 0) {
    findings.push({
      tone: 'bad',
      title: `You are making a loss of ${tzs(Math.abs(net))}`,
      detail: `Product cost and expenses together (${tzs(cogs + expenses)}) are more than your sales (${tzs(revenue)}).`,
    });
  }
  if (grossMargin < 10) {
    findings.push({
      tone: grossMargin < 5 ? 'bad' : 'warn',
      title: `Margin per sale is thin: you keep only ${pct(grossMargin)} after product cost`,
      detail: `Even with big sales, a thin margin leaves little to keep. ${
        grossMargin < 10
          ? `Raising your average selling price by about ${pct(((10 - grossMargin) / 100 / (1 - 0.1)) * 100)} would lift the margin to 10% — about ${tzs(Math.round(((10 - grossMargin) / 100 / (1 - 0.1)) * revenue))} more profit on this period's sales. `
          : ''
      }Start with the products listed below, and ask your supplier for a better buying price.`,
    });
  }
  if (expOfGross !== null && expOfGross >= 50) {
    findings.push({
      tone: expOfGross >= 90 ? 'bad' : 'warn',
      title: `Expenses take ${pct(expOfGross)} of your gross profit`,
      detail: topCat ? `The biggest is ${topCat.category} (${tzs(topCat.amount)}, ${pct((topCat.amount / expenses) * 100)} of all expenses).` : 'Open Expenses to see which ones are biggest.',
    });
  } else if (expOfGross === null && expenses > 0) {
    findings.push({ tone: 'bad', title: 'There is no gross profit to pay expenses from', detail: 'Product cost is as high as sales. Check prices and costs.' });
  }
  if (discountPct >= 1.5) {
    findings.push({
      tone: discountPct >= 4 ? 'bad' : 'warn',
      title: `You gave ${tzs(discount)} in discounts (${pct(discountPct)} of sales)`,
      detail: 'Every TZS of discount comes straight out of your profit.',
    });
  }
  const atLoss = low.filter((p) => p.margin_pct <= 0);
  if (atLoss.length > 0) {
    findings.push({
      tone: 'bad',
      title: `${atLoss.map((p) => p.product_name).join(', ')} ${atLoss.length === 1 ? 'was' : 'were'} sold at or below cost`,
      detail: 'Each sale of these loses money or earns nothing. Raise the price or buy cheaper.',
    });
  }

  // Bar: product cost | expenses | profit, as a share of sales. If the first
  // two exceed 100% (a loss) the bar scales to them so nothing is cut off.
  const total = Math.max(100, per100(cogs) + per100(expenses));
  const seg = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  const maxCat = Math.max(1, ...cats.map((c) => c.amount));

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HelpCircle size={16} className="text-green-600 dark:text-green-400" aria-hidden="true" />
          <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Why is my profit small?</h3>
        </div>
        {periodLabel && <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:bg-[#0e1512] dark:text-[#97a49b]">{periodLabel}</span>}
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-[#b6c2ba]">
        Out of every <b>TZS 100</b> you sold: <b>TZS {Math.round(per100(cogs))}</b> paid for the products, <b>TZS {Math.round(per100(expenses))}</b> went to expenses, and{' '}
        <b className={net >= 0 ? 'text-green-700 dark:text-green-300' : 'text-danger-600 dark:text-danger-300'}>{net >= 0 ? `TZS ${Math.round(per100(net))} is your profit` : `you lost TZS ${Math.abs(Math.round(per100(net)))}`}</b>.
      </p>

      <div className="mt-3 flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[#0e1512]" role="img" aria-label="Where sales money went">
        <div className="ff-grow-x h-full bg-slate-400 dark:bg-slate-500" style={{ ...dly(300), width: seg(per100(cogs)) }} />
        <div className="ff-grow-x h-full bg-amber-400" style={{ ...dly(500), width: seg(per100(expenses)) }} />
        {net > 0 && <div className="ff-grow-x h-full bg-green-500" style={{ ...dly(700), width: seg(per100(net)) }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-[#97a49b]">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />Products {tzs(cogs)}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Expenses {tzs(expenses)}</span>
        <span><span className={clsx('mr-1 inline-block h-2 w-2 rounded-full', net >= 0 ? 'bg-green-500' : 'bg-danger-500')} />{net >= 0 ? 'Profit' : 'Loss'} {tzs(Math.abs(net))}</span>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {findings.length === 0 ? (
          <div className="flex gap-2.5 rounded-xl bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-200">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>Profit looks healthy: you keep {pct(grossMargin)} after product cost and expenses use {expOfGross === null ? '—' : pct(expOfGross)} of gross profit.</p>
          </div>
        ) : (
          findings.map((f) => (
            <div
              key={f.title}
              className={clsx(
                'flex gap-2.5 rounded-xl p-3 text-sm',
                f.tone === 'bad' ? 'bg-danger-50 text-danger-800 dark:bg-danger-900/30 dark:text-danger-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
              )}
            >
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold">{f.title}</p>
                <p className="mt-0.5 text-[13px] opacity-90">{f.detail}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Biggest expenses</h4>
          {cats.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-[#97a49b]">No expenses recorded in this period.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2.5">
              {cats.slice(0, 5).map((c, i) => (
                <li key={c.category}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-[#d2dbd5]">{c.category}</span>
                    <span className="shrink-0 tabular-nums text-slate-500 dark:text-[#97a49b]">
                      {tzs(c.amount)} <b className="ml-1 text-slate-800 dark:text-[#eef3ef]">{pct((c.amount / expenses) * 100)}</b>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-[#0e1512]">
                    <div className="ff-grow-x h-full rounded-full bg-amber-400" style={{ ...dly(600 + i * 120), width: `${Math.max(3, (c.amount / maxCat) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Products earning the least</h4>
          {low.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-[#97a49b]">No product sales in this period.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2.5">
              {low.map((p) => (
                <li key={p.product_name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-[#d2dbd5]">{p.product_name}</span>
                  <span className="shrink-0 tabular-nums text-slate-500 dark:text-[#97a49b]">
                    sold {tzs(p.revenue)} ·{' '}
                    <b className={p.margin_pct <= 0 ? 'text-danger-600 dark:text-danger-300' : p.margin_pct < 5 ? 'text-amber-600 dark:text-amber-300' : 'text-slate-800 dark:text-[#eef3ef]'}>{pct(p.margin_pct)} margin</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
