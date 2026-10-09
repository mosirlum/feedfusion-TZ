import { ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, Boxes, ClipboardList, Hourglass, Phone, ShoppingCart, TrendingDown, TrendingUp, Trophy, Wallet } from 'lucide-react';
import type {
  BusinessGrowthAnalysis,
  BusinessGrowthDetails,
  GrowthCustomerDebt,
  GrowthCustomerRevenue,
  GrowthReorderSuggestion,
  GrowthSlowMovingItem,
  GrowthTrendPoint,
} from '../../types';
import { compactNumber, formatDate, tzs } from '../../lib/format';
import { useElementWidth } from '../../lib/useElementWidth';
import { Badge, Card, EmptyState, IconChip, SegmentedControl, Skeleton } from '../ui';

// Business Growth detail sections (2026-10-09). Everything here renders data
// the backend already computed (businessGrowthDetails.service.ts) — no
// business rules live in the browser, only presentation.

type Tone = 'green' | 'blue' | 'amber' | 'red' | 'slate';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodLabel(period: string, kind: 'weekly' | 'monthly'): string {
  if (kind === 'monthly') {
    const [y, m] = period.split('-');
    const name = MONTHS[Number(m) - 1] ?? period;
    return m === '01' ? `${name} ${y.slice(2)}` : name;
  }
  return formatDate(period).slice(0, 6); // "05 Oct"
}

function periodTitle(point: GrowthTrendPoint, kind: 'weekly' | 'monthly'): string {
  if (kind === 'monthly') {
    const [y, m] = point.period.split('-');
    return `${MONTHS[Number(m) - 1] ?? point.period} ${y}${point.isPartial ? ' (so far)' : ''}`;
  }
  return `Week of ${formatDate(point.period)}${point.isPartial ? ' (so far)' : ''}`;
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({
  id,
  icon,
  tone,
  title,
  subtitle,
  action,
  children,
}: {
  id: string;
  icon: ReactNode;
  tone: Tone;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <IconChip tone={tone} icon={icon} size={36} />
            <div>
              <h2 id={`${id}-title`} className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">
                {title}
              </h2>
              {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-[#97a49b]">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
        {children}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Attention tiles — one glance, each jumps to its section.
// ---------------------------------------------------------------------------
const TILE_TONE: Record<Tone, string> = {
  green: 'text-green-700 dark:text-green-300',
  blue: 'text-blue-700 dark:text-blue-300',
  amber: 'text-amber-700 dark:text-amber-300',
  red: 'text-danger-600 dark:text-danger-300',
  slate: 'text-slate-700 dark:text-[#d2dbd5]',
};

function Tile({ href, label, value, hint, tone, icon }: { href: string; label: string; value: ReactNode; hint: ReactNode; tone: Tone; icon: ReactNode }) {
  return (
    <a
      href={href}
      className="group block rounded-card border border-slate-200 bg-white p-4 shadow-card transition duration-150 hover:-translate-y-0.5 hover:shadow-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 active:translate-y-0 dark:border-[rgba(255,255,255,0.08)] dark:bg-[#121a16]"
    >
      <div className="flex items-center justify-between">
        <IconChip tone={tone} icon={icon} size={32} />
        <ArrowRight size={14} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">{label}</p>
      <p className={clsx('mt-0.5 font-display text-xl font-extrabold tabular-nums', TILE_TONE[tone])}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">{hint}</p>
    </a>
  );
}

export function AttentionTiles({ details, week }: { details: BusinessGrowthDetails | null; week: BusinessGrowthAnalysis['week'] }) {
  const weekTone: Tone =
    week.status === 'ahead' ? 'green' : week.status === 'on_track' ? 'blue' : week.status === 'behind' ? 'amber' : week.status === 'critical' ? 'red' : 'slate';
  const weekValue = week.pctOfExpected !== null ? `${Math.round(week.pctOfExpected)}%` : '—';
  const urgent = details?.reorder.items.filter((r) => r.urgency === 'now').length ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        href="#trend"
        label="This week"
        value={weekValue}
        hint={week.pctOfExpected !== null ? 'of a normal week so far' : 'building history'}
        tone={weekTone}
        icon={weekTone === 'red' || weekTone === 'amber' ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
      />
      {details ? (
        <>
          <Tile
            href="#reorder"
            label="To reorder"
            value={details.reorder.totalCount}
            hint={urgent > 0 ? `${urgent} urgent` : details.reorder.totalCount > 0 ? 'running low soon' : 'stock cover is healthy'}
            tone={urgent > 0 ? 'red' : details.reorder.totalCount > 0 ? 'amber' : 'green'}
            icon={<ShoppingCart size={16} />}
          />
          <Tile
            href="#slow"
            label="Stuck stock"
            value={tzs(details.slowMoving.totalValueTiedUp)}
            hint={`${details.slowMoving.totalCount} product${details.slowMoving.totalCount === 1 ? '' : 's'} not moving`}
            tone={details.slowMoving.totalCount > 0 ? 'amber' : 'green'}
            icon={<Hourglass size={16} />}
          />
          <Tile
            href="#customers"
            label="Owed by customers"
            value={tzs(details.customers.debts.totalOutstanding)}
            hint={`${details.customers.debts.debtorCount} customer${details.customers.debts.debtorCount === 1 ? '' : 's'} with a balance`}
            tone={details.customers.debts.totalOutstanding > 0 ? 'red' : 'green'}
            icon={<Wallet size={16} />}
          />
        </>
      ) : (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-[124px] rounded-card" />)
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend — weekly / monthly revenue bars + gross-profit line on ONE axis.
// ---------------------------------------------------------------------------
function niceMax(dataMax: number): number {
  if (dataMax <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
  const normalized = dataMax / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function ChangePill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-slate-400 dark:text-[#77857c]">no comparison</span>;
  const up = pct >= 0;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
        up ? 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-danger-50 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300'
      )}
    >
      {up ? '↗' : '↘'} {Math.abs(pct)}%
    </span>
  );
}

function TrendChart({
  points,
  kind,
  selected,
  onSelect,
  baselineFullWeek,
}: {
  points: GrowthTrendPoint[];
  kind: 'weekly' | 'monthly';
  selected: number;
  onSelect: (i: number) => void;
  baselineFullWeek: number | null;
}) {
  const { ref, width } = useElementWidth(720);
  const compact = width < 480;
  const height = compact ? 200 : 230;
  const pad = { top: 12, right: 8, bottom: 26, left: compact ? 36 : 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = points.length;
  const step = innerW / n;
  const barW = Math.min(36, step * 0.62);
  const showBaseline = kind === 'weekly' && baselineFullWeek !== null;
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.revenue, p.grossProfit)), showBaseline ? baselineFullWeek! : 0, 1));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const cx = (i: number) => pad.left + i * step + step / 2;
  const labelEvery = compact ? Math.ceil(n / 4) : n > 8 ? 2 : 1;
  const linePts = points.map((p, i) => `${cx(i)},${y(p.grossProfit)}`).join(' ');

  return (
    <div ref={ref} className="w-full">
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block max-w-full" role="img" aria-label={`${kind === 'weekly' ? 'Weekly' : 'Monthly'} revenue and gross profit`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.left} x2={width - pad.right} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" className="text-slate-200 dark:text-[rgba(255,255,255,0.1)]" strokeWidth={1} />
          <text x={pad.left - 8} y={y(max * f)} dominantBaseline="middle" textAnchor="end" fontSize={11} className="fill-slate-400 dark:fill-[#77857c]">
            {compactNumber(max * f)}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const x = cx(i) - barW / 2;
        const top = y(p.revenue);
        const base = y(0);
        const isSel = i === selected;
        return (
          <g
            key={p.period}
            tabIndex={0}
            role="button"
            aria-label={`${periodTitle(p, kind)}: revenue ${tzs(p.revenue)}, gross profit ${tzs(p.grossProfit)}`}
            onClick={() => onSelect(i)}
            onMouseEnter={() => onSelect(i)}
            onFocus={() => onSelect(i)}
            className="cursor-pointer outline-none [&:focus-visible>rect.hit]:stroke-green-500"
          >
            <rect className="hit fill-transparent" x={cx(i) - step / 2} y={pad.top} width={step} height={innerH + 4} rx={6} strokeWidth={1.5} stroke="transparent" />
            {isSel && <rect x={cx(i) - step / 2 + 2} y={pad.top} width={step - 4} height={innerH} rx={6} className="fill-green-500/10" />}
            <rect
              x={x}
              y={top}
              width={barW}
              height={Math.max(base - top, 0)}
              rx={4}
              className={p.isPartial ? 'fill-green-500/15 stroke-green-600' : isSel ? 'fill-green-600' : 'fill-green-500'}
              strokeDasharray={p.isPartial ? '4 3' : undefined}
              strokeWidth={p.isPartial ? 1.5 : 0}
            />
          </g>
        );
      })}
      {showBaseline && (
        <g>
          <line x1={pad.left} x2={width - pad.right} y1={y(baselineFullWeek!)} y2={y(baselineFullWeek!)} stroke="#2a78d6" strokeWidth={1.25} strokeDasharray="5 4" opacity={0.7} />
        </g>
      )}
      <polyline points={linePts} fill="none" stroke="#eb6834" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
      {points.map((p, i) => (
        <circle key={`d-${p.period}`} cx={cx(i)} cy={y(p.grossProfit)} r={i === selected ? 4.5 : 3} className="fill-white dark:fill-[#121a16]" stroke="#eb6834" strokeWidth={2} pointerEvents="none" />
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={`l-${p.period}`} x={cx(i)} y={height - 7} textAnchor="middle" fontSize={11} className={clsx(i === selected ? 'fill-slate-700 font-semibold dark:fill-[#d2dbd5]' : 'fill-slate-400 dark:fill-[#77857c]')}>
            {periodLabel(p.period, kind)}
          </text>
        ) : null
      )}
    </svg>
    </div>
  );
}

export function TrendSection({ details, week }: { details: BusinessGrowthDetails; week: BusinessGrowthAnalysis['week'] }) {
  const [kind, setKind] = useState<'weekly' | 'monthly'>('weekly');
  const points = kind === 'weekly' ? details.trend.weekly : details.trend.monthly;
  // Default readout = the latest *complete* period (a partial one isn't comparable).
  const defaultIndex = useMemo(() => {
    for (let i = points.length - 1; i >= 0; i--) if (!points[i].isPartial) return i;
    return Math.max(points.length - 1, 0);
  }, [points]);
  const [picked, setPicked] = useState<{ kind: string; index: number } | null>(null);
  const selected = picked && picked.kind === kind && picked.index < points.length ? picked.index : defaultIndex;
  const baselineFullWeek = week.expectedToDate !== null && week.daysElapsed > 0 ? (week.expectedToDate / week.daysElapsed) * 7 : null;
  const sel = points[selected];
  const margin = sel && sel.revenue > 0 ? Math.round((sel.grossProfit / sel.revenue) * 1000) / 10 : null;

  return (
    <Section
      id="trend"
      icon={<TrendingUp size={18} />}
      tone="green"
      title="Sales trend"
      subtitle="Revenue and gross profit, period by period"
      action={
        <SegmentedControl
          label="Trend period"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
        />
      }
    >
      {points.length === 0 || points.every((p) => p.revenue === 0) ? (
        <EmptyState title="No sales in this period yet." description="The trend appears after the first completed sales." />
      ) : (
        <div className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4" aria-live="polite">
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">{sel ? periodTitle(sel, kind) : '—'}</p>
              <div className="mt-1">{sel && <ChangePill pct={sel.revenueChangePct} />}</div>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-[#97a49b]">Revenue</p>
              <p className="font-display text-lg font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{tzs(sel?.revenue)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-[#97a49b]">Gross profit</p>
              <p className="font-display text-lg font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{tzs(sel?.grossProfit)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-[#97a49b]">Margin</p>
              <p className="font-display text-lg font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{margin === null ? '—' : `${margin}%`}</p>
            </div>
          </div>
          <TrendChart
            points={points}
            kind={kind}
            selected={selected}
            onSelect={(i) => setPicked({ kind, index: i })}
            baselineFullWeek={baselineFullWeek}
          />
          <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-[#97a49b]">
            <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" aria-hidden="true" />Revenue</li>
            <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[#eb6834]" aria-hidden="true" />Gross profit</li>
            {kind === 'weekly' && baselineFullWeek !== null && (
              <li className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-blue-500" aria-hidden="true" />Usual full week</li>
            )}
            <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-green-600 bg-green-500/15" aria-hidden="true" />Period still running</li>
          </ul>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Reorder suggestions
// ---------------------------------------------------------------------------
function CoverBar({ days, urgency }: { days: number | null; urgency: 'now' | 'soon' }) {
  const pct = days === null ? 0 : Math.min(100, Math.round((days / 14) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[rgba(255,255,255,0.08)]" aria-hidden="true">
      <div className={clsx('h-full rounded-full', urgency === 'now' ? 'bg-danger-500' : 'bg-amber-500')} style={{ width: `${Math.max(pct, days === 0 ? 0 : 4)}%` }} />
    </div>
  );
}

function ReorderRow({ item }: { item: GrowthReorderSuggestion }) {
  const unit = item.unit ?? 'units';
  const coverText = item.daysOfCover === null ? '—' : item.daysOfCover <= 0 ? 'Out of stock' : `${item.daysOfCover} day${item.daysOfCover === 1 ? '' : 's'} left`;
  return (
    <li className="grid gap-3 px-5 py-4 transition-colors hover:bg-slate-50/70 dark:hover:bg-[#0e1512]/40 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-[#eef3ef]">{item.name}</span>
          <Badge tone={item.urgency === 'now' ? 'red' : 'amber'}>{item.urgency === 'now' ? 'Order now' : 'Order soon'}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">
          Selling about {item.avgDailySales.toLocaleString('en', { maximumFractionDigits: 1 })} {unit}/day · minimum {item.minimumStock}
        </p>
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="tabular-nums text-slate-700 dark:text-[#d2dbd5]">
            {item.currentStock} {unit} in stock
          </span>
          <span className={clsx('text-xs font-semibold', item.urgency === 'now' ? 'text-danger-600 dark:text-danger-300' : 'text-amber-700 dark:text-amber-300')}>{coverText}</span>
        </div>
        <CoverBar days={item.daysOfCover} urgency={item.urgency} />
      </div>
      <div className="sm:text-right">
        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-[#eef3ef]">
          Order {item.suggestedQty} {unit}
        </p>
        <p className="text-xs text-slate-500 dark:text-[#97a49b]">{item.estimatedCost !== null ? `≈ ${tzs(item.estimatedCost)}` : 'no purchase cost on record'}</p>
      </div>
    </li>
  );
}

export function ReorderSection({ data }: { data: BusinessGrowthDetails['reorder'] }) {
  const total = data.items.reduce((sum, i) => sum + (i.estimatedCost ?? 0), 0);
  return (
    <Section
      id="reorder"
      icon={<ShoppingCart size={18} />}
      tone="red"
      title="What to reorder"
      subtitle="Based on how fast each product sold in the last 30 days"
      action={
        <Link to="/purchases" className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400">
          Go to Purchases <ArrowRight size={14} aria-hidden="true" />
        </Link>
      }
    >
      {data.items.length === 0 ? (
        <EmptyState icon={<Boxes size={28} />} title="Nothing needs reordering right now." description="Every product that sells regularly has at least 10 days of stock." />
      ) : (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)]">
            {data.items.map((i) => (
              <ReorderRow key={i.productId} item={i} />
            ))}
          </ul>
          <div className="flex flex-col gap-1 border-t border-slate-100 px-5 py-3 text-sm dark:border-[rgba(255,255,255,0.08)] sm:flex-row sm:items-center sm:justify-between">
            <span className="text-slate-500 dark:text-[#97a49b]">
              {data.totalCount > data.items.length ? `Showing the ${data.items.length} most urgent of ${data.totalCount}. ` : ''}
              Suggested quantities cover about 14 days of sales.
            </span>
            {total > 0 && (
              <span className="font-semibold tabular-nums text-slate-800 dark:text-[#eef3ef]">Estimated cost: {tzs(total)}</span>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Slow-moving stock
// ---------------------------------------------------------------------------
function SlowRow({ item }: { item: GrowthSlowMovingItem }) {
  const unit = item.unit ?? 'units';
  const why =
    item.reason === 'no_recent_sales'
      ? item.daysSinceLastSale === null
        ? 'No sales on record'
        : `Last sale ${item.daysSinceLastSale} days ago`
      : `${item.daysOfCover ?? '—'} days of stock at the current pace`;
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50/70 dark:hover:bg-[#0e1512]/40">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-[#eef3ef]">{item.name}</span>
          <Badge tone={item.reason === 'no_recent_sales' ? 'amber' : 'blue'}>{item.reason === 'no_recent_sales' ? 'Not selling' : 'Too much stock'}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">{why}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-[#eef3ef]">{item.stockValueCost !== null ? tzs(item.stockValueCost) : '—'}</p>
        <p className="text-xs tabular-nums text-slate-500 dark:text-[#97a49b]">
          {item.currentStock} {unit}
        </p>
      </div>
    </li>
  );
}

export function SlowMovingSection({ data }: { data: BusinessGrowthDetails['slowMoving'] }) {
  return (
    <Section
      id="slow"
      icon={<Hourglass size={18} />}
      tone="amber"
      title="Stock that isn't moving"
      subtitle={data.totalCount > 0 ? `${tzs(data.totalValueTiedUp)} of cash is sitting on these shelves` : 'Products with stock but few or no recent sales'}
    >
      {data.items.length === 0 ? (
        <EmptyState icon={<Boxes size={28} />} title="Everything in stock is selling." description="No product has gone 30 days without a sale." />
      ) : (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)]">
            {data.items.map((i) => (
              <SlowRow key={i.productId} item={i} />
            ))}
          </ul>
          <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500 dark:border-[rgba(255,255,255,0.08)] dark:text-[#97a49b]">
            {data.totalCount > data.items.length ? `Showing ${data.items.length} of ${data.totalCount}. ` : ''}
            Try a discount, a bundle with a fast seller, or a visible display spot to turn this stock back into cash.
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Customers — who brings the money in, and who still owes it
// ---------------------------------------------------------------------------
function CallLink({ phone, name }: { phone: string | null; name: string }) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone}`}
      aria-label={`Call ${name} on ${phone}`}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-green-50 hover:text-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:hover:bg-green-900/40 dark:hover:text-green-300"
    >
      <Phone size={15} aria-hidden="true" />
    </a>
  );
}

function TopCustomerRow({ c, rank, max }: { c: GrowthCustomerRevenue; rank: number; max: number }) {
  return (
    <li className="px-5 py-3.5 transition-colors hover:bg-slate-50/70 dark:hover:bg-[#0e1512]/40">
      <div className="flex items-center gap-3">
        <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums', rank === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-[#0e1512] dark:text-[#97a49b]')}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-slate-800 dark:text-[#eef3ef]">{c.name}</p>
          <p className="text-xs text-slate-500 dark:text-[#97a49b]">
            {c.salesCount} purchase{c.salesCount === 1 ? '' : 's'}
          </p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-[#eef3ef]">{tzs(c.revenue)}</p>
        <CallLink phone={c.phone} name={c.name} />
      </div>
      <div className="ml-10 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[rgba(255,255,255,0.08)]" aria-hidden="true">
        <div className="h-full rounded-full bg-green-500" style={{ width: `${max > 0 ? Math.max(3, Math.round((c.revenue / max) * 100)) : 0}%` }} />
      </div>
    </li>
  );
}

function DebtRow({ d }: { d: GrowthCustomerDebt }) {
  const overdue = d.overdueBalance > 0;
  return (
    <li className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50/70 dark:hover:bg-[#0e1512]/40">
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold text-slate-800 dark:text-[#eef3ef]">{d.name}</p>
        <p className="text-xs text-slate-500 dark:text-[#97a49b]">
          {d.invoices} unpaid invoice{d.invoices === 1 ? '' : 's'}
          {d.oldestDueDate ? ` · oldest due ${formatDate(d.oldestDueDate)}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-[#eef3ef]">{tzs(d.balanceDue)}</p>
        {overdue ? (
          <p className="text-xs font-semibold tabular-nums text-danger-600 dark:text-danger-300">{tzs(d.overdueBalance)} overdue</p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-[#97a49b]">not yet due</p>
        )}
      </div>
      <CallLink phone={d.phone} name={d.name} />
    </li>
  );
}

export function CustomersSection({ data }: { data: BusinessGrowthDetails['customers'] }) {
  const max = data.top[0]?.revenue ?? 0;
  return (
    <section id="customers" aria-label="Customers" className="grid scroll-mt-20 gap-6 lg:grid-cols-2">
      <Card>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">
          <IconChip tone="green" icon={<Trophy size={18} />} size={36} />
          <div>
            <h2 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Best customers</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-[#97a49b]">Most spent in the last {data.windowDays} days</p>
          </div>
        </div>
        {data.top.length === 0 ? (
          <EmptyState icon={<ClipboardList size={28} />} title="No named customers yet." description="Sales recorded with a customer attached will rank here." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)]">
            {data.top.map((c, i) => (
              <TopCustomerRow key={`${c.name}-${i}`} c={c} rank={i + 1} max={max} />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">
          <IconChip tone="red" icon={<Wallet size={18} />} size={36} />
          <div>
            <h2 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Who owes you</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-[#97a49b]">
              {data.debts.debtorCount > 0 ? `${tzs(data.debts.totalOutstanding)} across ${data.debts.debtorCount} customer${data.debts.debtorCount === 1 ? '' : 's'}` : 'Credit sales waiting to be paid'}
            </p>
          </div>
        </div>
        {data.debts.items.length === 0 ? (
          <EmptyState icon={<Wallet size={28} />} title="Nobody owes you anything." description="Every credit sale has been paid in full." />
        ) : (
          <>
            <ul className="divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)]">
              {data.debts.items.map((d, i) => (
                <DebtRow key={`${d.name}-${i}`} d={d} />
              ))}
            </ul>
            <div className="border-t border-slate-100 px-5 py-3 text-sm dark:border-[rgba(255,255,255,0.08)]">
              <Link to="/sales-history" className="inline-flex items-center gap-1 font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400">
                See every unpaid sale <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

export function DetailsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading details">
      <Skeleton className="h-[360px] rounded-card" />
      <Skeleton className="h-56 rounded-card" />
      <Skeleton className="h-48 rounded-card" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    </div>
  );
}
