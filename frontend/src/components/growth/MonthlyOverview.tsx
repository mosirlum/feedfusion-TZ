import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Minus, RefreshCw, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react';
import { businessGrowthApi } from '../../lib/api';
import type { GrowthMonthlyOverview, GrowthOverviewMonth, GrowthVerdict } from '../../types';
import { compactNumber, tzs } from '../../lib/format';
import { useElementWidth } from '../../lib/useElementWidth';
import { Button, Card, EmptyState, Skeleton } from '../ui';
import { Section } from './GrowthDetails';

// Business Growth — monthly performance (2026-10-27, step 2 of the owner's
// "comparison between months" request: "tujue kuwa tunapata faida au hasara
// na tunaenda wapi"). Six months side by side with a plain PROFIT / LOSS
// verdict per month and a rule-based "where are we heading". Every number and
// verdict comes from the backend (businessGrowthOverview.service.ts); this
// file is presentation only.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (key: string) => MONTH_NAMES[Number(key.split('-')[1]) - 1] ?? key;
const shortMonth = (key: string) => monthName(key).slice(0, 3);

// Series colours (checked with the dataviz validator for light and dark
// surfaces). Revenue reuses the app's green; net profit is blue.
const REVENUE_CLASS = 'fill-green-500';
const PROFIT_CLASS = 'fill-[#2a78d6] dark:fill-[#4a90de]';

const VERDICT_META: Record<GrowthVerdict, { label: string; icon: JSX.Element; chip: string }> = {
  profit: { label: 'Profit', icon: <CheckCircle2 size={13} />, chip: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  loss: { label: 'Loss', icon: <TrendingDown size={13} />, chip: 'bg-danger-50 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300' },
  breakeven: { label: 'Break-even', icon: <Minus size={13} />, chip: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  no_data: { label: 'No data', icon: <Minus size={13} />, chip: 'bg-slate-100 text-slate-500 dark:bg-[rgba(255,255,255,0.06)] dark:text-[#97a49b]' },
};

function VerdictChip({ verdict, partial }: { verdict: GrowthVerdict; partial?: boolean }) {
  const meta = VERDICT_META[verdict];
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', meta.chip)}>
      {meta.icon}
      {meta.label}
      {partial && verdict !== 'no_data' ? ' so far' : ''}
    </span>
  );
}

const signedTzs = (n: number) => (n < 0 ? `−${tzs(Math.abs(n))}` : tzs(n));
// Table cells drop the "TZS " prefix (the column header says it) so six months fit without sideways scrolling.
const plain = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-TZ', { maximumFractionDigits: 0 })}`;
const pctText = (p: number | null) => (p === null ? null : `${p > 0 ? '+' : ''}${p}%`);

function monthsLabel(keys: string[]): string {
  if (keys.length === 1) return monthName(keys[0]);
  return `the ${keys.length} months ${shortMonth(keys[0])}–${shortMonth(keys[keys.length - 1])}`;
}

function trajectoryText(t: GrowthMonthlyOverview['trajectory']): string {
  if (t.status === 'not_enough_data' || t.recentAvgNetProfit === null || t.earlierAvgNetProfit === null) {
    return 'Not enough history yet. A direction needs at least two full months of sales.';
  }
  const verb = t.status === 'improving' ? 'is improving' : t.status === 'declining' ? 'is slipping' : 'is holding steady';
  const per = t.recentMonths.length > 1 ? ' a month' : '';
  const perEarlier = t.earlierMonths.length > 1 ? ' a month' : '';
  const rev = t.revenueChangePct === null ? '' : ` Revenue is ${t.revenueChangePct >= 0 ? 'up' : 'down'} ${Math.abs(t.revenueChangePct)}% over the same comparison.`;
  return `Net profit ${verb}: ${signedTzs(t.recentAvgNetProfit)}${per} in ${monthsLabel(t.recentMonths)}, against ${signedTzs(t.earlierAvgNetProfit)}${perEarlier} in ${monthsLabel(t.earlierMonths)}.${rev}`;
}

// ---------------------------------------------------------------------------
// Chart — grouped bars (revenue, net profit) on ONE shared TZS axis with a
// real zero line, so a loss month visibly drops below it.
// ---------------------------------------------------------------------------

function niceStep(range: number, targetTicks = 4): number {
  const raw = Math.max(range, 1) / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function MonthlyChart({ months }: { months: GrowthOverviewMonth[] }) {
  const { ref, width } = useElementWidth(720);
  const [active, setActive] = useState<number | null>(null);
  const compact = width < 480;
  const height = compact ? 220 : 260;
  const pad = { top: 14, right: 8, bottom: 28, left: compact ? 40 : 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = months.length;
  const step = innerW / n;
  const barW = Math.min(24, step * 0.3);

  const { min, max, ticks } = useMemo(() => {
    const lo = Math.min(0, ...months.map((m) => m.metrics.netProfit));
    const hi = Math.max(1, ...months.map((m) => m.metrics.revenue));
    const s = niceStep(hi - lo);
    const tmin = Math.floor(lo / s) * s;
    const tmax = Math.ceil(hi / s) * s;
    const t: number[] = [];
    for (let v = tmin; v <= tmax + s / 2; v += s) t.push(Math.round(v));
    return { min: tmin, max: tmax, ticks: t };
  }, [months]);

  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min)) * innerH;
  const cx = (i: number) => pad.left + i * step + step / 2;
  const zeroY = y(0);

  const bar = (v: number, x: number, partial: boolean, cls: string) => {
    const top = Math.min(y(v), zeroY);
    const h = Math.abs(y(v) - zeroY);
    return (
      <rect
        x={x}
        y={top}
        width={barW}
        height={Math.max(h, v === 0 ? 0 : 1)}
        rx={3}
        className={clsx(cls, partial && 'opacity-40')}
        stroke={partial ? 'currentColor' : undefined}
        strokeDasharray={partial ? '4 3' : undefined}
        strokeWidth={partial ? 1.25 : 0}
      />
    );
  };

  const act = active !== null ? months[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(cx(active), 90), width - 90) : 0;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full text-slate-500 dark:text-[#97a49b]"
        role="img"
        aria-label="Revenue and net profit for each of the last six months"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.55 : 0.18} strokeWidth={t === 0 ? 1.25 : 1} />
            <text x={pad.left - 8} y={y(t)} dominantBaseline="middle" textAnchor="end" fontSize={11} fill="currentColor">
              {t < 0 ? `−${compactNumber(Math.abs(t))}` : compactNumber(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => (
          <g
            key={m.month}
            tabIndex={0}
            role="img"
            aria-label={`${monthName(m.month)}${m.isPartial ? ' so far' : ''}: revenue ${tzs(m.metrics.revenue)}, net profit ${signedTzs(m.metrics.netProfit)}, ${VERDICT_META[m.verdict].label}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((a) => (a === i ? null : a))}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((a) => (a === i ? null : a))}
            className="outline-none [&:focus-visible>rect.hit]:stroke-green-500"
          >
            <rect
              className="hit fill-transparent"
              x={cx(i) - step / 2}
              y={pad.top}
              width={step}
              height={innerH + pad.bottom - 4}
              rx={6}
              stroke="transparent"
              strokeWidth={1.5}
            />
            {active === i && <rect x={cx(i) - step / 2 + 2} y={pad.top} width={step - 4} height={innerH} rx={6} className="fill-slate-500/10" pointerEvents="none" />}
            {bar(m.metrics.revenue, cx(i) - barW - 1, m.isPartial, REVENUE_CLASS)}
            {bar(m.metrics.netProfit, cx(i) + 1, m.isPartial, PROFIT_CLASS)}
            <text
              x={cx(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize={11}
              fill="currentColor"
              className={clsx(active === i && 'font-semibold')}
            >
              {shortMonth(m.month)}
              {m.isPartial ? '*' : ''}
            </text>
          </g>
        ))}
      </svg>

      {act && (
        <div
          role="status"
          className="pointer-events-none absolute top-1 z-10 w-44 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-panel dark:border-[rgba(255,255,255,0.12)] dark:bg-[#1a2420]"
          style={{ left: tipLeft }}
        >
          <p className="mb-1 font-semibold text-slate-700 dark:text-[#d2dbd5]">
            {monthName(act.month)}
            {act.isPartial ? ' (so far)' : ''}
          </p>
          <p className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-[#97a49b]">
              <span className="h-0.5 w-3 rounded bg-green-500" aria-hidden="true" />
              Revenue
            </span>
            <span className="font-bold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{tzs(act.metrics.revenue)}</span>
          </p>
          <p className="mt-0.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-[#97a49b]">
              <span className="h-0.5 w-3 rounded bg-[#2a78d6] dark:bg-[#4a90de]" aria-hidden="true" />
              Net profit
            </span>
            <span className="font-bold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{signedTzs(act.metrics.netProfit)}</span>
          </p>
          <div className="mt-1.5">
            <VerdictChip verdict={act.verdict} partial={act.isPartial} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table view — the same numbers, every month, always reachable without hover.
// ---------------------------------------------------------------------------

type Row = { label: string; value: (m: GrowthOverviewMonth) => string; strong?: boolean };

const ROWS: Row[] = [
  { label: 'Revenue', value: (m) => plain(m.metrics.revenue) },
  { label: 'Gross profit', value: (m) => plain(m.metrics.grossProfit) },
  { label: 'Expenses', value: (m) => plain(m.metrics.expenses) },
  { label: 'Net profit', value: (m) => plain(m.metrics.netProfit), strong: true },
  { label: 'Margin', value: (m) => (m.marginPct === null ? '—' : `${m.marginPct < 0 ? '−' : ''}${Math.abs(m.marginPct)}%`) },
  { label: 'Sales', value: (m) => m.metrics.salesCount.toLocaleString('en-TZ') },
  { label: 'Customers served', value: (m) => m.metrics.customersServed.toLocaleString('en-TZ') },
  { label: 'New customers', value: (m) => m.metrics.newCustomers.toLocaleString('en-TZ') },
];

function MonthTable({ months }: { months: GrowthOverviewMonth[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <caption className="sr-only">Revenue, costs and profit for each of the last six months</caption>
        <thead>
          <tr className="border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)]">
            <th scope="col" className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-[#121a16] dark:text-[#97a49b]">
              Month (TZS)
            </th>
            {months.map((m) => (
              <th key={m.month} scope="col" className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 dark:text-[#b7c3bb]">
                {shortMonth(m.month)}
                {m.isPartial && <span className="block text-[10px] font-normal text-slate-400 dark:text-[#77857c]">so far</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)]">
            <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2.5 text-left text-xs font-semibold text-slate-600 dark:bg-[#121a16] dark:text-[#b7c3bb]">
              Result
            </th>
            {months.map((m) => (
              <td key={m.month} className="px-3 py-2.5 text-right">
                <VerdictChip verdict={m.verdict} />
              </td>
            ))}
          </tr>
          {ROWS.map((row) => (
            <tr key={row.label} className="border-b border-slate-100 last:border-0 dark:border-[rgba(255,255,255,0.08)]">
              <th
                scope="row"
                className={clsx(
                  'sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2.5 text-left text-xs dark:bg-[#121a16]',
                  row.strong ? 'font-bold text-slate-800 dark:text-[#eef3ef]' : 'font-medium text-slate-600 dark:text-[#b7c3bb]'
                )}
              >
                {row.label}
              </th>
              {months.map((m) => (
                <td
                  key={m.month}
                  className={clsx(
                    'whitespace-nowrap px-3 py-2.5 text-right tabular-nums',
                    row.strong ? 'font-bold text-slate-800 dark:text-[#f4f8f5]' : 'text-slate-600 dark:text-[#b7c3bb]',
                    row.label === 'Net profit' && m.verdict === 'loss' && 'text-danger-600 dark:text-danger-300',
                    m.verdict === 'no_data' && 'text-slate-300 dark:text-[#4f5c54]'
                  )}
                >
                  {m.verdict === 'no_data' ? '—' : row.value(m)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MonthlyOverviewSection() {
  const [data, setData] = useState<GrowthMonthlyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    let cancelled = false;
    businessGrowthApi
      .monthlyOverview()
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  if (loading && !data) return <Skeleton className="h-96 rounded-card" />;

  if (failed || !data) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="Couldn't load the monthly performance."
          description="The rest of the page is unaffected. Try again in a moment."
          action={<Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={load}>Try again</Button>}
        />
      </Card>
    );
  }

  const { months, trajectory: t, completeMonthsTotal: total } = data;
  const lastFull = months.find((m) => m.month === data.lastFullMonth) ?? null;
  const current = months[months.length - 1];
  const hasAnything = months.some((m) => m.verdict !== 'no_data');
  const tone = t.status === 'improving' ? 'green' : t.status === 'declining' ? 'red' : 'slate';
  const TrajIcon = t.status === 'improving' ? TrendingUp : t.status === 'declining' ? TrendingDown : Minus;
  const trajLabel = { improving: 'Improving', steady: 'Steady', declining: 'Declining', not_enough_data: 'Too early to say' }[t.status];

  return (
    <Section
      id="monthly-performance"
      icon={<BarChart3 size={18} />}
      tone="blue"
      title="Are we making a profit?"
      subtitle="The last six months side by side, with a plain profit or loss for each month"
    >
      {!hasAnything ? (
        <EmptyState title="No sales or expenses recorded yet." description="The monthly picture appears once the shop has completed sales." />
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3.5 dark:bg-[rgba(255,255,255,0.04)]">
              <p className="text-xs text-slate-500 dark:text-[#97a49b]">{lastFull ? `Last full month · ${monthName(lastFull.month)}` : 'Last full month'}</p>
              {lastFull ? (
                <>
                  <p className="mt-1 font-display text-lg font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{signedTzs(lastFull.metrics.netProfit)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <VerdictChip verdict={lastFull.verdict} />
                    {lastFull.marginPct !== null && <span className="text-xs text-slate-500 dark:text-[#97a49b]">{lastFull.marginPct}% of revenue</span>}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500 dark:text-[#97a49b]">No full month of sales yet.</p>
              )}
            </div>

            <div className="rounded-lg bg-slate-50 p-3.5 dark:bg-[rgba(255,255,255,0.04)]">
              <p className="text-xs text-slate-500 dark:text-[#97a49b]">{monthName(current.month)} so far</p>
              <p className="mt-1 font-display text-lg font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{signedTzs(current.metrics.netProfit)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <VerdictChip verdict={current.verdict} partial />
                {data.missingMonthlyExpenses && <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">see note below</span>}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3.5 dark:bg-[rgba(255,255,255,0.04)]">
              <p className="text-xs text-slate-500 dark:text-[#97a49b]">Where we are heading</p>
              <p
                className={clsx(
                  'mt-1 inline-flex items-center gap-1.5 font-display text-lg font-extrabold',
                  tone === 'green' && 'text-green-700 dark:text-green-300',
                  tone === 'red' && 'text-danger-600 dark:text-danger-300',
                  tone === 'slate' && 'text-slate-800 dark:text-[#f4f8f5]'
                )}
              >
                <TrajIcon size={18} aria-hidden="true" />
                {trajLabel}
              </p>
              {total.profitMonths + total.lossMonths > 0 && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-[#97a49b]">
                  {total.profitMonths} profit {total.profitMonths === 1 ? 'month' : 'months'}, {total.lossMonths} loss · {signedTzs(total.netProfit)} net over full months
                </p>
              )}
            </div>
          </div>

          <p className="mt-4 text-sm font-semibold text-slate-700 dark:text-[#d9e3dc]" aria-live="polite">
            {trajectoryText(t)}
          </p>

          {data.missingMonthlyExpenses && (
            <div className="mt-3 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p>
                <span className="font-semibold">{monthName(data.missingMonthlyExpenses.month)} may look better than it is.</span> {data.missingMonthlyExpenses.categories.join(', ')}{' '}
                {data.missingMonthlyExpenses.categories.length === 1 ? 'was' : 'were'} recorded last month as a monthly cost but {data.missingMonthlyExpenses.categories.length === 1 ? 'has' : 'have'} not been added for {monthName(data.missingMonthlyExpenses.month)} yet, so this month's profit is overstated until {data.missingMonthlyExpenses.categories.length === 1 ? 'it is' : 'they are'} entered on the Expenses page.
              </p>
            </div>
          )}

          <div className="mt-5">
            <MonthlyChart months={months} />
            <ul className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-[#97a49b]">
              <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" aria-hidden="true" />Revenue</li>
              <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2a78d6] dark:bg-[#4a90de]" aria-hidden="true" />Net profit (after all costs; below the line is a loss)</li>
              <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-500 opacity-60" aria-hidden="true" />* month still running</li>
            </ul>
          </div>
        </div>
      )}
      {hasAnything && (
        <div className="border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)]">
          <MonthTable months={months} />
          <p className="px-5 pb-4 pt-1 text-xs text-slate-500 dark:text-[#97a49b]">
            Net profit = gross profit (sales minus what the stock cost) minus expenses. Monthly costs such as salary and rent count in the month they are dated. A month is called break-even when profit is within 1% of revenue.
          </p>
        </div>
      )}
    </Section>
  );
}
