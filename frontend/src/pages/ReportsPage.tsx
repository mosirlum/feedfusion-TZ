import { ReactNode, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  BarChart3,
  Package,
  Tag,
  Wallet,
  ShoppingCart,
  Users as UsersIcon,
  Database,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  XCircle,
  Lightbulb,
  Trophy,
  Clock,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  Download,
  Printer,
  FileText,
  Loader2,
} from 'lucide-react';
import { reportsApi, apiErrorMessage, apiErrorMessageFromBlob } from '../lib/api';
import { tzs, formatDate, isoDaysAgo, todayIso, initials, currentWeekRange, currentYearRange, monthRange, MONTH_NAMES, compactNumber } from '../lib/format';
import { downloadCsv } from '../lib/exportCsv';
import {
  Badge,
  Button,
  Card,
  CHART_COLORS,
  DonutChart,
  EmptyState,
  FullPageSpinner,
  IconChip,
  Input,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { InventoryRow, DailySalesPoint } from '../types';

/**
 * Reports page redesign (2026-09-12, CLAUDE.md #41) — from the owner's own
 * reference mockup, which showed the "Sales" tab in full (stat cards with
 * real trends, a daily chart, two donuts, a Top 5 list, a Cash History
 * preview, a paginated transactions table, and an auto-generated "Quick
 * Insights" panel). The other 7 tabs weren't shown redesigned in the
 * mockup, so they keep their existing table-based layout — this redesign
 * is scoped to Sales, not a rebuild of every tab.
 *
 * One genuine data gap, confirmed with the owner via AskUserQuestion before
 * building: the mockup's "Sales by Payment Method" donut (Cash/Card/Mobile
 * Money) assumes payment types this system doesn't have — `payments.method`
 * is locked to `CASH` by a database CHECK constraint (an explicit MVP
 * scope decision, not an oversight). The owner chose to replace it with
 * "Revenue by Staff Member" — real, already-tracked data — rather than
 * drop the second donut or show a meaningless "100% Cash" slice.
 *
 * The mockup's "Sales Overview" chart combines a revenue bar chart and a
 * transactions line chart on two y-axes in one plot. Dual-axis charts are
 * avoided here on purpose — two measures of different scale are drawn as
 * two aligned single-axis charts (small multiples) sharing the same date
 * labels, rather than one chart whose second axis has no visible scale.
 *
 * The date range control gained an explicit "Apply" button (the owner's
 * mockup shows one) — typing in the From/To fields no longer refetches on
 * every keystroke; only Apply (or first load) commits a new range.
 */

const TABS = [
  { key: 'Sales', icon: BarChart3 },
  { key: 'Products', icon: Package },
  { key: 'Discounts', icon: Tag },
  { key: 'Cash', icon: Wallet },
  { key: 'Purchases', icon: ShoppingCart },
  { key: 'Users', icon: UsersIcon },
  { key: 'Stock', icon: Database },
  { key: 'Low Stock', icon: AlertTriangle },
] as const;
type Tab = (typeof TABS)[number]['key'];

// Reports date-range presets (2026-09-13, CLAUDE.md #62) — the owner asked
// for Week/Month/Year quick presets and a specific-month picker alongside
// the existing custom From/To range ("report iko mess so ioneshe kila
// kitu" — the range picker should make it easy to get any period, not
// just whatever's been manually typed). "Custom" preserves the exact
// pre-existing behavior (manual From/To + Apply button); the other three
// presets compute their range immediately and re-fetch right away, no
// separate Apply click needed since there's nothing left to type.
type RangePreset = 'week' | 'month' | 'year' | 'custom';
// Judgment call: the month/year pickers only go back 3 years (this project
// is a brand-new MVP with no years of back-data yet) — easy to widen later
// if the owner needs older history.
const YEAR_OPTIONS = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('Sales');
  const [preset, setPreset] = useState<RangePreset>('custom');
  const [draftFrom, setDraftFrom] = useState(isoDaysAgo(30));
  const [draftTo, setDraftTo] = useState(todayIso());
  const [from, setFrom] = useState(draftFrom);
  const [to, setTo] = useState(draftTo);
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [generatingReport, setGeneratingReport] = useState(false);
  const toast = useToast();

  const needsRange = tab !== 'Stock' && tab !== 'Low Stock';

  /**
   * "Generate Report" (2026-09-13, CLAUDE.md #64; print flow changed same
   * day, #64 follow-up) — the owner explicitly rejected "print the
   * dashboard as PDF" as the wrong deliverable ("we dont print dashboard
   * into pdf we need the report... intro to end graphs some explanation...
   * give me the insights"). This button is the real replacement: it builds
   * a separately-composed, rule-based narrative document from the backend
   * (narrativeReport.service.ts + pdfReport.service.ts) for whatever range
   * is currently selected above — it doesn't print anything already on
   * screen. Lives at the page level (not inside ReportToolbar, which is
   * per-tab Download/Print) since the narrative report is its own separate
   * document, not a rendering of whichever tab happens to be open.
   *
   * Opens the generated PDF in a new browser tab rather than forcing an
   * immediate silent download, per the owner's follow-up feedback after
   * trying the first version ("co print kivyake generate kivyake" —
   * generate and print should be two separate steps, generate first, then
   * print). The browser's own PDF viewer already has Print and Save/
   * Download buttons built in, so this one change covers both without any
   * extra print plumbing on our side.
   */
  async function handleGenerateReport() {
    setGeneratingReport(true);
    try {
      const res = await reportsApi.narrativePdf(from, to);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Revoked well after the new tab has had time to load the blob: URL
      // into its PDF viewer — revoking immediately risks a race where the
      // new tab hasn't finished fetching it yet and shows a blank page.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(await apiErrorMessageFromBlob(err, 'Could not generate the report.'));
    } finally {
      setGeneratingReport(false);
    }
  }

  function applyRange(f: string, t: string) {
    setDraftFrom(f);
    setDraftTo(t);
    setFrom(f);
    setTo(t);
  }

  function selectPreset(p: RangePreset) {
    setPreset(p);
    if (p === 'week') applyRange(...currentWeekRange());
    else if (p === 'year') applyRange(...currentYearRange());
    else if (p === 'month') applyRange(...monthRange(pickerYear, pickerMonth));
    // 'custom' leaves the existing draft/from/to alone — the inputs below take over.
  }

  function selectMonth(monthIndex: number, year: number) {
    setPickerMonth(monthIndex);
    setPickerYear(year);
    applyRange(...monthRange(year, monthIndex));
  }

  return (
    <div>
      <PageHeader
        icon={<BarChart3 size={20} />}
        title="Reports"
        subtitle="Everything you need to understand your business performance."
        action={
          needsRange ? (
            <div className="no-print flex flex-wrap items-center gap-2">
              <CalendarRange size={16} className="hidden text-slate-400 sm:block" />
              <div className="flex overflow-hidden rounded-lg border border-slate-200">
                {(['week', 'month', 'year', 'custom'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => selectPreset(p)}
                    className={clsx(
                      'px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                      preset === p ? 'bg-green-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    {p === 'week' ? 'This Week' : p === 'month' ? 'Month' : p === 'year' ? 'This Year' : 'Custom'}
                  </button>
                ))}
              </div>

              {preset === 'month' && (
                <>
                  <select
                    value={pickerMonth}
                    onChange={(e) => selectMonth(Number(e.target.value), pickerYear)}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={pickerYear}
                    onChange={(e) => selectMonth(pickerMonth, Number(e.target.value))}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
                  >
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {preset === 'custom' && (
                <>
                  <span className="text-xs font-medium text-slate-500">From</span>
                  <Input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} max={draftTo} className="w-auto" />
                  <span className="text-xs font-medium text-slate-500">To</span>
                  <Input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} min={draftFrom} max={todayIso()} className="w-auto" />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setFrom(draftFrom);
                      setTo(draftTo);
                    }}
                  >
                    Apply
                  </Button>
                </>
              )}

              <div className="mx-1 h-6 w-px bg-slate-200" />
              <Button
                type="button"
                size="sm"
                icon={generatingReport ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                onClick={handleGenerateReport}
                disabled={generatingReport}
              >
                {generatingReport ? 'Generating…' : 'Generate Report'}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-slate-200">
        {TABS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-1.5 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors',
              tab === key ? 'border-b-2 border-green-600 text-green-700' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon size={14} />
            {key}
          </button>
        ))}
      </div>

      <div className="print-area">
        {tab === 'Sales' && <SalesOverviewTab from={from} to={to} onViewCash={() => setTab('Cash')} />}
        {tab === 'Products' && <ProductsReport from={from} to={to} />}
        {tab === 'Discounts' && <DiscountsReport from={from} to={to} />}
        {tab === 'Cash' && <CashReport from={from} to={to} />}
        {tab === 'Purchases' && <PurchaseCostsReportView from={from} to={to} />}
        {tab === 'Users' && <UsersReport from={from} to={to} />}
        {tab === 'Stock' && <StockReport low={false} />}
        {tab === 'Low Stock' && <StockReport low />}
      </div>
    </div>
  );
}

/**
 * Download + Print (2026-09-12, CLAUDE.md #42) — every Reports tab gets
 * both. "Download" is a client-side CSV of that tab's own already-fetched
 * rows (same pattern as Expenses' "Export," CLAUDE.md #40, now shared via
 * `lib/exportCsv.ts`); each tab builds its own header/rows since the shape
 * differs per report. "Print" is `window.print()` scoped to whichever tab
 * is on screen via the app's existing `.print-area`/`.no-print` convention
 * (already used for receipts) — the tab bar, page header, and this toolbar
 * itself are marked `no-print` (or simply live outside `.print-area`) so
 * only the report's own content and the letterhead below reach paper.
 *
 * `showPrint` (2026-09-13, CLAUDE.md #64 follow-up) — the owner flagged
 * this Print button as duplicate work specifically on the Sales tab, once
 * "Generate Report" existed right above it: the new PDF already opens in
 * the browser's own viewer with its own Print button, so having a second,
 * different-looking Print action right next to it felt redundant ("print
 * inapatikana kwenye generate report" — print is already in Generate
 * Report). That reasoning is Sales-specific — Generate Report only
 * narrates Sales data (CLAUDE.md #64's own scope note), so the other 7
 * tabs have no substitute and keep their Print button; only
 * `SalesOverviewTab` passes `showPrint={false}`. Download CSV is
 * unaffected everywhere — it's a different, complementary export (the raw
 * row data), not something Generate Report replaces.
 */
/**
 * `downloadLabel` (2026-09-14, CLAUDE.md #68e) — the Sales tab now passes
 * "Download Excel" here (its `onDownload` fetches a real server-built
 * .xlsx instead of building a CSV client-side); every other tab is
 * unaffected and keeps the default "Download CSV" label and behavior.
 * `onDownload` may now be async — this button awaits it and shows a
 * spinner + disables itself meanwhile, since a network request (unlike
 * the old synchronous client-side CSV build) has real, visible latency.
 */
function ReportToolbar({
  onDownload,
  showPrint = true,
  downloadLabel = 'Download CSV',
}: {
  onDownload: () => void | Promise<void>;
  showPrint?: boolean;
  downloadLabel?: string;
}) {
  const [downloading, setDownloading] = useState(false);
  async function handleDownload() {
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div className="no-print mb-3 flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        onClick={handleDownload}
        disabled={downloading}
      >
        {downloading ? 'Preparing…' : downloadLabel}
      </Button>
      {showPrint && (
        <Button type="button" variant="outline" size="sm" icon={<Printer size={14} />} onClick={() => window.print()}>
          Print
        </Button>
      )}
    </div>
  );
}

// A letterhead that exists only on paper — invisible on screen (`.print-only`,
// see index.css) — so a printed report identifies itself and its date range
// without cluttering the on-screen dashboard with a redundant heading.
function PrintLetterhead({ title, from, to }: { title: string; from?: string; to?: string }) {
  return (
    <div className="print-only mb-4 border-b-2 border-slate-800 pb-3">
      <p className="text-lg font-bold text-slate-900">Feed Fusion Tanzania — {title} Report</p>
      <p className="text-sm text-slate-600">
        {from && to ? `${formatDate(from)} to ${formatDate(to)} · ` : ''}
        Printed {new Date().toLocaleString()}
      </p>
    </div>
  );
}

function useReport<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    loader()
      .then(setData)
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load this report.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}

// ---------------------------------------------------------------------------
// Sales tab — the one the mockup showed in full.
// ---------------------------------------------------------------------------

function buildDonutSlices(items: { name: string; value: number }[], total: number, capTop = 4) {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, capTop);
  const rest = sorted.slice(capTop);
  const restTotal = rest.reduce((s, r) => s + r.value, 0);
  const slices = top.map((s, i) => ({ ...s, color: CHART_COLORS[i % (CHART_COLORS.length - 1)], pct: total > 0 ? (s.value / total) * 100 : 0 }));
  if (rest.length > 0) {
    slices.push({ name: 'Others', value: restTotal, color: CHART_COLORS[CHART_COLORS.length - 1], pct: total > 0 ? (restTotal / total) * 100 : 0 });
  }
  return slices;
}

function TrendLabel({ pct, invert }: { pct: number | null; invert?: boolean }) {
  if (pct == null) return <span className="text-xs text-slate-400">No prior period to compare</span>;
  const isGood = invert ? pct <= 0 : pct >= 0;
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', isGood ? 'text-green-700' : 'text-danger-600')}>
      <Icon size={12} />
      {pct > 0 ? '+' : ''}
      {pct.toFixed(0)}% vs previous period
    </span>
  );
}

// Rounds a scale's max up to a "clean" number (1/2/5 × a power of ten) —
// e.g. 334,000 → 400,000, 61,050 → 70,000 — so the y-axis gridlines below
// read as round figures instead of an arbitrary max sale total, and every
// bar/line gets a little headroom instead of the tallest point touching the
// very top edge.
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  const step = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return step * magnitude;
}

// Two aligned single-axis mini-charts (never one dual-axis chart — see file
// header comment) sharing the same x positions/date labels so a bar chart
// (revenue) and a line chart (transactions) read as one "Sales Overview"
// even though each has its own scale.
//
// `showGrid` (2026-09-14, CLAUDE.md #68 follow-up) — the owner's own words
// on the un-gridded version: "this one looks so messy". With a real shop's
// data this chart is mostly zeros (a brand-new system with only a few days
// of real sales) followed by a small cluster of bars right at the end —
// with no baseline, gridlines, or y-axis scale at all, that read as a
// handful of shapes floating in a mostly-empty box rather than a chart.
// `showGrid` adds a hairline baseline + two recessive gridlines with
// compact value labels (dataviz skill's mark spec: "one-step-off-surface
// gray, hairline, recessive") so every bar/line has something to be
// measured against. Left off the per-stat-card sparklines below, which
// stay deliberately minimal — a 32px-tall trend line has no room for an
// axis and isn't meant to be read as a precise chart.
function DailyChart({
  series,
  valueKey,
  variant,
  color,
  formatValue,
  height = 120,
  showLabels = false,
  showGrid = false,
}: {
  series: DailySalesPoint[];
  valueKey: 'revenue' | 'transactions' | 'discount' | 'voided';
  variant: 'bar' | 'line';
  color: string;
  formatValue: (v: number) => string;
  height?: number;
  showLabels?: boolean;
  showGrid?: boolean;
}) {
  const width = 640;
  const padding = { top: 10, right: 6, bottom: showLabels ? 18 : 4, left: showGrid ? 32 : 6 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const values = series.map((d) => d[valueKey]);
  const dataMax = Math.max(...values, 0);
  const max = showGrid ? niceMax(dataMax) : Math.max(dataMax, 1);
  const n = series.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const xFor = (i: number) => padding.left + (n > 1 ? i * stepX : innerW / 2);
  const yFor = (v: number) => padding.top + innerH - (max > 0 ? (v / max) * innerH : 0);
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const gridTicks = showGrid ? [0, max / 2, max] : [];

  if (n === 0) return <EmptyState title="No data in this range." />;

  // A bar shaped as the mark spec asks for: rounded top ("data-end"),
  // square where it meets the baseline — never a fully-rounded rect, which
  // looks like a pill floating above the axis rather than growing from it.
  function barPath(x: number, yTop: number, w: number, yBase: number, r: number) {
    if (yBase - yTop <= 0) return '';
    const radius = Math.min(r, w / 2, yBase - yTop);
    return `M${x},${yBase} L${x},${yTop + radius} Q${x},${yTop} ${x + radius},${yTop} L${x + w - radius},${yTop} Q${x + w},${yTop} ${x + w},${yTop + radius} L${x + w},${yBase} Z`;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {showGrid &&
        gridTicks.map((t, i) => (
          <g key={`grid-${i}`}>
            <line x1={padding.left} x2={width - padding.right} y1={yFor(t)} y2={yFor(t)} stroke="#E2E8F0" strokeWidth={1} />
            <text x={padding.left - 6} y={yFor(t)} dominantBaseline="middle" fontSize={9} textAnchor="end" fill="#94A3B8">
              {compactNumber(t)}
            </text>
          </g>
        ))}
      {variant === 'bar' ? (
        series.map((d, i) => {
          const barW = Math.min(24, Math.max(3, stepX * 0.5));
          const v = d[valueKey];
          return (
            <path key={d.date} d={barPath(xFor(i) - barW / 2, yFor(v), barW, yFor(0), 3)} fill={color}>
              <title>{`${formatDate(d.date)}: ${formatValue(v)}`}</title>
            </path>
          );
        })
      ) : (
        <>
          {/* A light wash under the line (dataviz mark spec: series hue at
              ~10% opacity) — grounds the line against the baseline instead
              of leaving it floating over blank white space. */}
          <polygon
            points={`${xFor(0)},${yFor(0)} ${series.map((d, i) => `${xFor(i)},${yFor(d[valueKey])}`).join(' ')} ${xFor(n - 1)},${yFor(0)}`}
            fill={color}
            opacity={0.1}
          />
          <polyline
            points={series.map((d, i) => `${xFor(i)},${yFor(d[valueKey])}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {series.map((d, i) => (
            <circle key={d.date} cx={xFor(i)} cy={yFor(d[valueKey])} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5}>
              <title>{`${formatDate(d.date)}: ${formatValue(d[valueKey])}`}</title>
            </circle>
          ))}
        </>
      )}
      {showGrid && <line x1={padding.left} x2={width - padding.right} y1={yFor(0)} y2={yFor(0)} stroke="#CBD5E1" strokeWidth={1} />}
      {showLabels &&
        series.map((d, i) => {
          // Always label the very last point too (not just every Nth one)
          // so the report's end date is never silently missing from the
          // x-axis just because it didn't land on a labelEvery multiple.
          if (i % labelEvery !== 0 && i !== n - 1) return null;
          // Real bug fixed 2026-09-13 (CLAUDE.md #62) — every label was
          // center-anchored, so the last one (closest to the right edge)
          // had its text extend past the SVG's own viewBox and get
          // silently clipped ("13 Sep" rendered as "13 Se"). The first and
          // last labels now anchor toward the inside of the chart instead
          // of straddling the edge; every label in between is unaffected.
          const isFirst = i === 0;
          const isLast = i === n - 1;
          return (
            <text
              key={`lbl-${d.date}`}
              x={xFor(i)}
              y={height - 4}
              fontSize={9}
              textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
              fill="#94A3B8"
            >
              {formatDate(d.date).slice(0, 6)}
            </text>
          );
        })}
    </svg>
  );
}

function StatCardWithSparkline({
  label,
  value,
  icon,
  tone,
  changePct,
  invert,
  sparklineData,
  sparklineColor,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone: 'green' | 'blue' | 'amber' | 'red';
  changePct: number | null;
  invert?: boolean;
  sparklineData: number[];
  sparklineColor: string;
}) {
  const tones: Record<string, string> = {
    green: 'bg-green-50 text-green-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-danger-50 text-danger-600',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div className={clsx('rounded-lg p-2', tones[tone])}>{icon}</div>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-800">{value}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <TrendLabel pct={changePct} invert={invert} />
      </div>
      {sparklineData.length > 1 && (
        <div className="mt-2">
          <DailyChart
            series={sparklineData.map((v, i) => ({ date: String(i), revenue: v, transactions: v, discount: v, voided: v }))}
            valueKey="revenue"
            variant="line"
            color={sparklineColor}
            formatValue={(v) => String(v)}
            height={32}
          />
        </div>
      )}
    </Card>
  );
}

function SalesOverviewTab({ from, to, onViewCash }: { from: string; to: string; onViewCash: () => void }) {
  const toast = useToast();
  const { data, loading } = useReport(() => reportsApi.salesOverview(from, to).then((r) => r.data), [from, to]);
  const [txPage, setTxPage] = useState(1);
  const [transactions, setTransactions] = useState<any[] | null>(null);
  const TX_PAGE_SIZE = 5;

  useEffect(() => {
    setTxPage(1);
    reportsApi
      .sales(from, to)
      .then((r: any) => setTransactions(r.data.sales))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load sales transactions.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  if (loading) return <FullPageSpinner />;
  if (!data) return null;

  const { current, changePct, dailySeries, revenueByCategory, revenueByStaff, topProducts, totalQuantitySold, cashHistory, lowStockCount } = data;

  const categoryTotal = revenueByCategory.reduce((s, c) => s + Number(c.revenue), 0);
  const categorySlices = buildDonutSlices(revenueByCategory.map((c) => ({ name: c.category_name, value: Number(c.revenue) })), categoryTotal);

  const staffTotal = revenueByStaff.reduce((s, c) => s + Number(c.revenue), 0);
  const staffSlices = buildDonutSlices(revenueByStaff.map((c) => ({ name: c.user_name, value: Number(c.revenue) })), staffTotal);

  const topProduct = topProducts[0] ?? null;
  const topProductPct = topProduct && totalQuantitySold > 0 ? (Number(topProduct.quantity_sold) / totalQuantitySold) * 100 : null;
  const topProductMaxQty = topProduct ? Number(topProduct.quantity_sold) : 1;

  const insights: Array<{ icon: typeof TrendingUp; tone: 'green' | 'red' | 'blue' | 'amber'; text: string; sub: string }> = [];
  if (changePct.totalRevenue != null) {
    const up = changePct.totalRevenue >= 0;
    insights.push({
      icon: up ? TrendingUp : TrendingDown,
      tone: up ? 'green' : 'red',
      text: `Revenue ${up ? 'increased' : 'decreased'} by ${Math.abs(changePct.totalRevenue).toFixed(0)}%`,
      sub: 'Compared to the previous period.',
    });
  }
  if (changePct.totalDiscount != null && current.totalDiscount > 0) {
    const up = changePct.totalDiscount >= 0;
    insights.push({
      icon: Tag,
      tone: up ? 'amber' : 'green',
      text: `Discounts are ${up ? 'up' : 'down'} by ${Math.abs(changePct.totalDiscount).toFixed(0)}%`,
      sub: up ? 'Keep an eye on discount patterns.' : 'Fewer discounts than the previous period.',
    });
  }
  if (topProduct) {
    insights.push({
      icon: Trophy,
      tone: 'blue',
      text: `${topProduct.product_name} is your top product`,
      sub: `${topProduct.quantity_sold} ${topProduct.unit} sold${topProductPct != null ? `, ${topProductPct.toFixed(0)}% of units sold` : ''}.`,
    });
  }
  if (lowStockCount > 0) {
    insights.push({
      icon: AlertTriangle,
      tone: 'red',
      text: 'Low stock alert',
      sub: `${lowStockCount} product${lowStockCount === 1 ? ' is' : 's are'} below minimum level.`,
    });
  }

  const txTotalPages = transactions ? Math.max(1, Math.ceil(transactions.length / TX_PAGE_SIZE)) : 1;
  const txPageItems = transactions ? transactions.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE) : [];

  /**
   * Download Excel (2026-09-14, CLAUDE.md #68e) — replaces this tab's old
   * client-side CSV build. The owner's own words after seeing the manual
   * colored analysis workbook built for him in chat: "that's what I
   * wanted, not just a normal excel" — so this now fetches the real
   * server-built .xlsx (KPI cards, a colored/filterable detail table, a
   * staff/day breakdown) and saves it, instead of writing a plain CSV in
   * the browser. A temporary anchor + object URL is the standard way to
   * save a blob response as a file; revoked right after the click since,
   * unlike the PDF report (opened in a tab, needs the URL to stay alive
   * while that tab loads it), nothing keeps referencing this URL once the
   * browser's own download has started.
   */
  async function downloadSalesExcel() {
    try {
      const res = await reportsApi.salesExcel(from, to);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Sales-Report-${from}-to-${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await apiErrorMessageFromBlob(err, 'Could not build the Excel report.'));
    }
  }

  return (
    <div>
      <ReportToolbar onDownload={downloadSalesExcel} showPrint={false} downloadLabel="Download Excel" />
      <PrintLetterhead title="Sales" from={from} to={to} />
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardWithSparkline
          label="Total Transactions"
          value={current.transactionCount}
          icon={<ShoppingCart size={18} />}
          tone="green"
          changePct={changePct.transactionCount}
          sparklineData={dailySeries.map((d) => d.transactions)}
          sparklineColor="#3B6D11"
        />
        <StatCardWithSparkline
          label="Total Revenue"
          value={tzs(current.totalRevenue)}
          icon={<Wallet size={18} />}
          tone="blue"
          changePct={changePct.totalRevenue}
          sparklineData={dailySeries.map((d) => d.revenue)}
          sparklineColor="#185FA5"
        />
        <StatCardWithSparkline
          label="Total Discounts"
          value={tzs(current.totalDiscount)}
          icon={<Tag size={18} />}
          tone="amber"
          changePct={changePct.totalDiscount}
          invert
          sparklineData={dailySeries.map((d) => d.discount)}
          sparklineColor="#F59E0B"
        />
        <StatCardWithSparkline
          label="Voided Sales"
          value={current.voidedCount}
          icon={<XCircle size={18} />}
          tone="red"
          changePct={changePct.voidedCount}
          invert
          sparklineData={dailySeries.map((d) => d.voided)}
          sparklineColor="#A32D2D"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr_1fr]">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-1 flex items-center gap-2">
            <IconChip tone="green" size={26} icon={<BarChart3 size={13} />} />
            <div>
              <p className="font-semibold text-slate-800">Sales Overview</p>
              <p className="text-xs text-slate-400">Daily revenue and transactions</p>
            </div>
          </div>
          <p className="mb-1 mt-3 text-xs font-medium text-slate-500">Revenue (TZS)</p>
          <DailyChart series={dailySeries} valueKey="revenue" variant="bar" color="#3B6D11" formatValue={tzs} showGrid />
          <p className="mb-1 mt-3 text-xs font-medium text-slate-500">Transactions</p>
          <DailyChart series={dailySeries} valueKey="transactions" variant="line" color="#185FA5" formatValue={(v) => String(v)} showLabels showGrid />
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <IconChip tone="blue" size={26} icon={<Package size={13} />} />
            <div>
              <p className="font-semibold text-slate-800">Revenue by Category</p>
              <p className="text-xs text-slate-400">Share of total revenue</p>
            </div>
          </div>
          {categorySlices.length === 0 ? (
            <EmptyState title="No sales in this range." />
          ) : (
            <div className="flex items-center gap-4">
              <DonutChart slices={categorySlices} centerValue={tzs(categoryTotal)} centerLabel="Total Revenue" />
              <div className="flex-1 space-y-1.5 text-xs">
                {categorySlices.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-slate-600">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                    <span className="flex-shrink-0 font-medium text-slate-700">{s.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconChip tone="amber" size={26} icon={<Trophy size={13} />} />
              <p className="font-semibold text-slate-800">Top 5 Best-Selling Products</p>
            </div>
          </div>
          {topProducts.length === 0 ? (
            <EmptyState title="No product sales in this range." />
          ) : (
            <ul className="space-y-3">
              {topProducts.map((p, i) => (
                <li key={p.product_id} className="flex items-center gap-3">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">{p.product_name}</p>
                      <p className="flex-shrink-0 text-xs text-slate-400">{tzs(p.revenue)}</p>
                    </div>
                    <p className="text-xs text-slate-400">
                      {p.quantity_sold} {p.unit}
                    </p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-green-600"
                        style={{ width: `${Math.min(100, (Number(p.quantity_sold) / topProductMaxQty) * 100)}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <IconChip tone="slate" size={26} icon={<UsersIcon size={13} />} />
            <div>
              <p className="font-semibold text-slate-800">Revenue by Staff Member</p>
              <p className="text-xs text-slate-400">Who served each sale</p>
            </div>
          </div>
          {staffSlices.length === 0 ? (
            <EmptyState title="No sales in this range." />
          ) : (
            <div className="flex items-center gap-4">
              <DonutChart slices={staffSlices} centerValue={tzs(staffTotal)} centerLabel="Total Revenue" />
              <div className="flex-1 space-y-1.5 text-xs">
                {staffSlices.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-slate-600">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                    <span className="flex-shrink-0 font-medium text-slate-700">{s.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconChip tone="green" size={26} icon={<Clock size={13} />} />
              <p className="font-semibold text-slate-800">Cash Count History</p>
            </div>
            <button type="button" onClick={onViewCash} className="text-xs font-medium text-green-700 hover:underline">
              View all
            </button>
          </div>
          {cashHistory.length === 0 ? (
            <EmptyState title="No cash counts in this range." />
          ) : (
            <div className="space-y-2">
              {cashHistory.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-slate-50 pb-2 text-xs last:border-0 last:pb-0">
                  <span className="text-slate-500">{formatDate(c.count_date)}</span>
                  <span
                    className={clsx(
                      'font-medium',
                      Number(c.difference) === 0 ? 'text-slate-600' : Number(c.difference) < 0 ? 'text-danger-600' : 'text-blue-700'
                    )}
                  >
                    {tzs(c.difference)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* print-allow-break (CLAUDE.md #63 follow-up): this is the one
            card allowed to split across a printed page boundary, since the
            table inside it can legitimately run to dozens of rows — every
            other Card on this page stays intact via index.css's default
            break-inside: avoid. */}
        <Card className="print-allow-break">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3" style={{ breakAfter: 'avoid' }}>
            <p className="font-semibold text-slate-800">Sales Transactions</p>
          </div>
          {!transactions || transactions.length === 0 ? (
            <EmptyState title="No sales in this range." />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Invoice No.</Th>
                    <Th>Date &amp; Time</Th>
                    <Th>Served By</Th>
                    <Th className="text-right">Total Amount</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {txPageItems.map((s: any) => (
                    <Tr key={s.id}>
                      <Td className="font-mono text-xs">{s.invoice_number}</Td>
                      <Td>{formatDate(s.sale_date)}</Td>
                      <Td>{s.served_by_name}</Td>
                      <Td className="text-right font-medium">{tzs(s.total)}</Td>
                      <Td>
                        <Badge tone={s.status === 'VOIDED' ? 'red' : 'green'}>{s.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
                <p className="text-xs text-slate-400">
                  Showing {txPageItems.length} of {transactions.length} sales
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={txPage <= 1}
                    onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="px-2 text-xs text-slate-500">
                    Page {txPage} of {txTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={txPage >= txTotalPages}
                    onClick={() => setTxPage((p) => Math.min(txTotalPages, p + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <IconChip tone="amber" size={26} icon={<Lightbulb size={13} />} />
            <p className="font-semibold text-slate-800">Quick Insights</p>
          </div>
          {insights.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Nothing notable in this range yet.</p>
          ) : (
            <ul className="space-y-3">
              {insights.map((ins, i) => {
                const Icon = ins.icon;
                const toneClass =
                  ins.tone === 'green'
                    ? 'bg-green-50 text-green-700'
                    : ins.tone === 'red'
                    ? 'bg-danger-50 text-danger-600'
                    : ins.tone === 'blue'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-amber-50 text-amber-700';
                return (
                  <li key={i} className="flex items-start gap-2.5">
                    <div className={clsx('mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg', toneClass)}>
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{ins.text}</p>
                      <p className="text-xs text-slate-400">{ins.sub}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remaining tabs — unchanged from before this redesign; the mockup only
// showed the Sales tab, so these keep their existing table-based layout.
// ---------------------------------------------------------------------------

function ProductsReport({ from, to }: { from: string; to: string }) {
  const { data, loading } = useReport(() => reportsApi.products(from, to).then((r) => r.data as any[]), [from, to]);
  if (loading) return <FullPageSpinner />;
  if (!data) return null;

  function downloadCsvFile() {
    downloadCsv(
      `products-report-${from}-to-${to}.csv`,
      ['Product', 'Qty Sold', 'Revenue (TZS)', 'Cost (TZS)', 'Gross Profit (TZS)'],
      data!.map((p) => [p.product_name, `${p.quantity_sold} ${p.unit}`, p.revenue, p.cost, p.gross_profit])
    );
  }

  return (
    <div>
      <ReportToolbar onDownload={downloadCsvFile} />
      <PrintLetterhead title="Products" from={from} to={to} />
      <Card>
      {data.length === 0 ? (
        <EmptyState title="No product sales in this range." />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Product</Th>
              <Th className="text-right">Qty Sold</Th>
              <Th className="text-right">Revenue</Th>
              <Th className="text-right">Cost</Th>
              <Th className="text-right">Gross Profit</Th>
            </tr>
          </THead>
          <tbody>
            {data.map((p) => (
              <Tr key={p.product_id}>
                <Td className="font-medium text-slate-800">{p.product_name}</Td>
                <Td className="text-right">
                  {p.quantity_sold} {p.unit}
                </Td>
                <Td className="text-right">{tzs(p.revenue)}</Td>
                <Td className="text-right text-slate-400">{tzs(p.cost)}</Td>
                <Td className="text-right font-semibold text-green-700">{tzs(p.gross_profit)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      </Card>
    </div>
  );
}

function DiscountsReport({ from, to }: { from: string; to: string }) {
  const { data, loading } = useReport(() => reportsApi.discounts(from, to).then((r) => r.data as any), [from, to]);
  if (loading) return <FullPageSpinner />;
  if (!data) return null;

  function downloadCsvFile() {
    downloadCsv(
      `discounts-report-${from}-to-${to}.csv`,
      ['Group', 'Name', 'Count', 'Total Discount (TZS)'],
      [
        ...data!.byUser.map((u: any) => ['Staff', u.user_name, u.discount_count, u.total_discount]),
        ...data!.byReason.map((r: any) => ['Reason', r.reason, r.discount_count, r.total_discount]),
      ]
    );
  }

  return (
    <div>
      <ReportToolbar onDownload={downloadCsvFile} />
      <PrintLetterhead title="Discounts" from={from} to={to} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card>
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">By Staff</div>
        {data.byUser.length === 0 ? (
          <EmptyState title="No discounts given in this range." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>User</Th>
                <Th className="text-right">Count</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </THead>
            <tbody>
              {data.byUser.map((u: any) => (
                <Tr key={u.user_id}>
                  <Td className="font-medium text-slate-800">{u.user_name}</Td>
                  <Td className="text-right">{u.discount_count}</Td>
                  <Td className="text-right">{tzs(u.total_discount)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">By Reason</div>
        {data.byReason.length === 0 ? (
          <EmptyState title="No discounts given in this range." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Reason</Th>
                <Th className="text-right">Count</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </THead>
            <tbody>
              {data.byReason.map((r: any, i: number) => (
                <Tr key={i}>
                  <Td>{r.reason}</Td>
                  <Td className="text-right">{r.discount_count}</Td>
                  <Td className="text-right">{tzs(r.total_discount)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      </div>
    </div>
  );
}

function CashReport({ from, to }: { from: string; to: string }) {
  const { data, loading } = useReport(() => reportsApi.cash(from, to).then((r) => r.data), [from, to]);
  if (loading) return <FullPageSpinner />;
  if (!data) return null;

  function downloadCsvFile() {
    downloadCsv(
      `cash-report-${from}-to-${to}.csv`,
      ['Date', 'Expected (TZS)', 'Actual (TZS)', 'Difference (TZS)', 'Counted By'],
      data!.map((c) => [formatDate(c.count_date), c.expected_cash, c.actual_cash, c.difference, c.counted_by_name ?? ''])
    );
  }

  return (
    <div>
      <ReportToolbar onDownload={downloadCsvFile} />
      <PrintLetterhead title="Cash" from={from} to={to} />
      <Card>
      {data.length === 0 ? (
        <EmptyState title="No cash counts in this range." />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Date</Th>
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Actual</Th>
              <Th className="text-right">Difference</Th>
              <Th>Counted by</Th>
            </tr>
          </THead>
          <tbody>
            {data.map((c) => (
              <Tr key={c.id}>
                <Td>{formatDate(c.count_date)}</Td>
                <Td className="text-right">{tzs(c.expected_cash)}</Td>
                <Td className="text-right">{tzs(c.actual_cash)}</Td>
                <Td className={`text-right font-medium ${Number(c.difference) === 0 ? 'text-slate-500' : 'text-danger-600'}`}>{tzs(c.difference)}</Td>
                <Td>{c.counted_by_name}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      </Card>
    </div>
  );
}

/**
 * Purchase Costs report (2026-09-12, CLAUDE.md #40) — the owner asked how to
 * see the total overhead purchasing added over a period in one place. Two
 * places money for that already lived separately: additional cost lines on
 * a purchase (freight/loading/storage that's on the supplier's invoice —
 * already folded into inventory cost/COGS) and Per-Purchase expenses
 * (incidental cash costs NOT on the invoice). Confirmed with the owner:
 * "Combined Overhead" is the sum of just those two — not the goods
 * themselves (already visible on Purchases/Suppliers) — and it's not meant
 * to be added into Net Profit a second time, since additional costs already
 * reduce gross profit through COGS. That distinction is called out in the
 * hint text below the stat card, not just in code comments, since it's the
 * one figure here most likely to be misread as "money I lost."
 */
function PurchaseCostsReportView({ from, to }: { from: string; to: string }) {
  const { data, loading } = useReport(() => reportsApi.purchaseCosts(from, to).then((r) => r.data), [from, to]);
  if (loading) return <FullPageSpinner />;
  if (!data) return null;
  const { summary } = data;

  function downloadCsvFile() {
    downloadCsv(
      `purchases-report-${from}-to-${to}.csv`,
      ['Reference', 'Date', 'Supplier', 'Goods Subtotal (TZS)', 'Additional Costs (TZS)', 'Total (TZS)'],
      data!.purchases.map((p) => [p.reference_number, formatDate(p.purchase_date), p.supplier_name, p.goods_subtotal, p.additional_costs, p.total_cost])
    );
  }

  return (
    <div>
      <ReportToolbar onDownload={downloadCsvFile} />
      <PrintLetterhead title="Purchases" from={from} to={to} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Purchases in Range" value={summary.purchaseCount} tone="purple" />
        <StatCard label="Goods Value" value={tzs(summary.totalGoodsValue)} tone="blue" hint="Cost of stock itself, not overhead" />
        <StatCard label="Additional Cost Lines" value={tzs(summary.totalAdditionalCosts)} tone="amber" hint="On supplier invoices — already in COGS" />
        <StatCard
          label="Combined Overhead"
          value={tzs(summary.combinedOverhead)}
          tone="red"
          hint="Cost lines + Per-Purchase expenses — not Net Profit"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">Additional Cost Lines by Label</div>
          {data.costLinesByLabel.length === 0 ? (
            <EmptyState title="No additional cost lines in this range." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Label</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </THead>
              <tbody>
                {data.costLinesByLabel.map((l, i) => (
                  <Tr key={i}>
                    <Td>{l.label}</Td>
                    <Td className="text-right font-medium">{tzs(l.total)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">
            Per-Purchase Expenses by Category
            <span className="ml-2 text-xs font-normal text-slate-400">Not on the supplier's invoice</span>
          </div>
          {data.perPurchaseByCategory.length === 0 ? (
            <EmptyState title="No Per-Purchase expenses in this range." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Category</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </THead>
              <tbody>
                {data.perPurchaseByCategory.map((c, i) => (
                  <Tr key={i}>
                    <Td>{c.category}</Td>
                    <Td className="text-right font-medium">{tzs(c.total)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-800">Purchases in Range</div>
        {data.purchases.length === 0 ? (
          <EmptyState title="No purchases in this range." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Reference</Th>
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th className="text-right">Goods Subtotal</Th>
                <Th className="text-right">Additional Costs</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </THead>
            <tbody>
              {data.purchases.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-mono text-xs">{p.reference_number}</Td>
                  <Td>{formatDate(p.purchase_date)}</Td>
                  <Td className="font-medium text-slate-800">{p.supplier_name}</Td>
                  <Td className="text-right text-slate-500">{tzs(p.goods_subtotal)}</Td>
                  <Td className="text-right font-medium text-amber-700">{tzs(p.additional_costs)}</Td>
                  <Td className="text-right font-semibold">{tzs(p.total_cost)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function UsersReport({ from, to }: { from: string; to: string }) {
  const { data, loading } = useReport(() => reportsApi.users(from, to).then((r) => r.data as any[]), [from, to]);
  if (loading) return <FullPageSpinner />;
  if (!data) return null;

  function downloadCsvFile() {
    downloadCsv(
      `users-report-${from}-to-${to}.csv`,
      ['Staff', 'Transactions', 'Revenue (TZS)', 'Discount Given (TZS)', 'Voided'],
      data!.map((u) => [u.name, u.transaction_count, u.total_revenue, u.total_discount, u.voided_count])
    );
  }

  return (
    <div>
      <ReportToolbar onDownload={downloadCsvFile} />
      <PrintLetterhead title="Users" from={from} to={to} />
      <Card>
      <p className="px-5 pt-4 text-xs text-slate-400">
        A performance signal, not an accusation — differences in revenue often reflect shifts worked, not conduct (Section 26).
      </p>
      {data.length === 0 ? (
        <EmptyState title="No sales staff activity in this range." />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Staff</Th>
              <Th className="text-right">Transactions</Th>
              <Th className="text-right">Revenue</Th>
              <Th className="text-right">Discount Given</Th>
              <Th className="text-right">Voided</Th>
            </tr>
          </THead>
          <tbody>
            {data.map((u) => (
              <Tr key={u.user_id}>
                <Td className="font-medium text-slate-800">{u.name}</Td>
                <Td className="text-right">{u.transaction_count}</Td>
                <Td className="text-right">{tzs(u.total_revenue)}</Td>
                <Td className="text-right">{tzs(u.total_discount)}</Td>
                <Td className="text-right">{u.voided_count}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      </Card>
    </div>
  );
}

function StockReport({ low }: { low: boolean }) {
  const { data, loading } = useReport(
    () => (low ? reportsApi.lowStock().then((r) => r.data) : reportsApi.stock().then((r) => r.data)),
    [low]
  );
  if (loading) return <FullPageSpinner />;
  if (!data) return null;

  function downloadCsvFile() {
    downloadCsv(
      `${low ? 'low-stock' : 'stock'}-report-as-of-${todayIso()}.csv`,
      ['Product', 'Current Stock', 'Min. Stock', 'Stock Value (cost, TZS)', 'Status'],
      data!.map((r: InventoryRow) => [r.name, `${r.current_stock} ${r.unit}`, `${r.minimum_stock} ${r.unit}`, r.stock_value_cost ?? '', r.status.replace('_', ' ')])
    );
  }

  return (
    <div>
      <ReportToolbar onDownload={downloadCsvFile} />
      <PrintLetterhead title={low ? 'Low Stock' : 'Stock'} />
      <Card>
      {data.length === 0 ? (
        <EmptyState title={low ? 'Nothing is low on stock right now.' : 'No products yet.'} />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Product</Th>
              <Th className="text-right">Current Stock</Th>
              <Th className="text-right">Min. Stock</Th>
              <Th className="text-right">Stock Value (cost)</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {data.map((r: InventoryRow) => (
              <Tr key={r.id}>
                <Td className="font-medium text-slate-800">{r.name}</Td>
                <Td className="text-right">
                  {r.current_stock} {r.unit}
                </Td>
                <Td className="text-right text-slate-400">
                  {r.minimum_stock} {r.unit}
                </Td>
                <Td className="text-right">{tzs(r.stock_value_cost)}</Td>
                <Td>
                  <Badge tone={r.status === 'HEALTHY' ? 'green' : r.status === 'LOW' ? 'amber' : 'red'}>{r.status.replace('_', ' ')}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      </Card>
    </div>
  );
}
