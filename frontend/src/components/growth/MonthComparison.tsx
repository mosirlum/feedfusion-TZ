import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CalendarRange, RefreshCw } from 'lucide-react';
import { businessGrowthApi } from '../../lib/api';
import type { GrowthMonthComparison, GrowthMonthMetrics } from '../../types';
import { tzs } from '../../lib/format';
import { Button, Card, EmptyState, Skeleton } from '../ui';
import { Section } from './GrowthDetails';

// Business Growth — month vs month, step 1 (2026-10-26, owner's request:
// "comparison between months"). Like-for-like: this month so far against the
// SAME NUMBER OF DAYS of last month, so a half-finished month is never set
// against a whole one. Last month's full totals sit underneath for reference.
// All numbers come from the backend (businessGrowthMonths.service.ts).

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(month: string): string {
  return MONTH_NAMES[Number(month.split('-')[1]) - 1] ?? month;
}

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

/** "1–26 October" */
function rangeLabel(from: string, to: string, month: string): string {
  return dayOf(from) === dayOf(to) ? `${dayOf(from)} ${monthName(month)}` : `${dayOf(from)}–${dayOf(to)} ${monthName(month)}`;
}

type Format = 'tzs' | 'count';

interface MetricDef {
  key: keyof GrowthMonthMetrics;
  label: string;
  format: Format;
  /** true when a rise is bad news (expenses). */
  higherIsWorse?: boolean;
}

const METRICS: MetricDef[] = [
  { key: 'revenue', label: 'Revenue', format: 'tzs' },
  { key: 'grossProfit', label: 'Gross profit', format: 'tzs' },
  { key: 'expenses', label: 'Expenses', format: 'tzs', higherIsWorse: true },
  { key: 'netProfit', label: 'Net profit', format: 'tzs' },
  { key: 'salesCount', label: 'Sales', format: 'count' },
  { key: 'avgSale', label: 'Average sale', format: 'tzs' },
  { key: 'customersServed', label: 'Customers served', format: 'count' },
  { key: 'newCustomers', label: 'New customers', format: 'count' },
];

function show(value: number | null, format: Format): string {
  if (value === null) return '—';
  return format === 'tzs' ? tzs(value) : value.toLocaleString('en-TZ');
}

function Delta({ pct, higherIsWorse }: { pct: number | null; higherIsWorse?: boolean }) {
  if (pct === null) return <span className="text-xs text-slate-400 dark:text-[#77857c]">no comparison</span>;
  if (pct === 0) return <span className="text-xs font-semibold text-slate-500 dark:text-[#97a49b]">no change</span>;
  const up = pct > 0;
  const good = higherIsWorse ? !up : up;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
        good ? 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-danger-50 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300'
      )}
    >
      {up ? '↗' : '↘'} {Math.abs(pct)}%
    </span>
  );
}

/** One plain-language line so the owner doesn't have to read eight tiles to get the point. */
function headline(d: GrowthMonthComparison): string {
  const prev = monthName(d.previousSamePeriod.month);
  const { revenue, netProfit } = d.changes;
  if (revenue === null) return `No ${prev} sales to compare with for these days yet.`;
  const word = (p: number) => (p > 0 ? 'up' : p < 0 ? 'down' : 'level');
  const pctText = (p: number) => (p === 0 ? '' : ` ${Math.abs(p)}%`);
  const base = `Revenue is ${word(revenue)}${pctText(revenue)} on the same days of ${prev}`;
  if (netProfit === null) return `${base}.`;
  return `${base}, and net profit is ${word(netProfit)}${pctText(netProfit)}.`;
}

export function MonthComparisonSection() {
  const [data, setData] = useState<GrowthMonthComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    let cancelled = false;
    businessGrowthApi
      .monthComparison()
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  if (loading && !data) return <Skeleton className="h-64 rounded-card" />;

  if (failed || !data) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="Couldn't load the month comparison."
          description="The rest of the page is unaffected. Try again in a moment."
          action={<Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={load}>Try again</Button>}
        />
      </Card>
    );
  }

  const cur = data.current;
  const prev = data.previousSamePeriod;
  const curLabel = rangeLabel(cur.from, cur.to, cur.month);
  const prevLabel = rangeLabel(prev.from, prev.to, prev.month);
  const nothingYet = METRICS.every((m) => cur.metrics[m.key] === 0 || cur.metrics[m.key] === null) && prev.metrics.revenue === 0;

  return (
    <Section
      id="month-comparison"
      icon={<CalendarRange size={18} />}
      tone="blue"
      title="This month vs last month"
      subtitle={`${curLabel} compared with ${prevLabel} — the same number of days`}
    >
      {nothingYet ? (
        <EmptyState title="No sales in either period yet." description="The comparison appears once there are completed sales." />
      ) : (
        <div className="p-4 sm:p-5">
          <p className="mb-4 text-sm font-semibold text-slate-700 dark:text-[#d9e3dc]" aria-live="polite">
            {headline(data)}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {METRICS.map((m) => (
              <div
                key={m.key}
                className="flex min-w-0 flex-col rounded-lg bg-slate-50 px-3 py-3 dark:bg-[rgba(255,255,255,0.04)] sm:px-3.5"
              >
                <p className="text-xs text-slate-500 dark:text-[#97a49b]">{m.label}</p>
                <p className="mt-1 whitespace-nowrap font-display text-[15px] font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5] max-[380px]:text-sm sm:text-lg">
                  {show(cur.metrics[m.key], m.format)}
                </p>
                <div className="mt-1.5">
                  <Delta pct={data.changes[m.key]} higherIsWorse={m.higherIsWorse} />
                </div>
                <p className="mt-2 whitespace-nowrap text-xs text-slate-500 tabular-nums dark:text-[#97a49b]">
                  {monthName(prev.month).slice(0, 3)}: {show(prev.metrics[m.key], m.format)}
                </p>
              </div>
            ))}
          </div>
          {!prev.isFullMonth && (
            <p className="mt-4 text-xs text-slate-500 dark:text-[#97a49b]">
              All of {monthName(data.previousFull.month)}: revenue {tzs(data.previousFull.metrics.revenue)} · net profit {tzs(data.previousFull.metrics.netProfit)} ·{' '}
              {data.previousFull.metrics.salesCount.toLocaleString('en-TZ')} sales. {monthName(cur.month)} is still running (day {cur.daysElapsed} of {cur.daysInMonth}), so it is
              compared with the same days, not the whole month.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
