import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  XCircle,
  Lightbulb,
  CheckCircle2,
  Minus,
  Package,
  Wallet,
  Tag,
  BarChart3,
  Boxes,
} from 'lucide-react';
import { businessGrowthApi, apiErrorMessage } from '../lib/api';
import { BusinessGrowthAnalysis, GrowthIssue, GrowthIssueCategory, GrowthIssueSeverity } from '../types';
import { tzs, formatDate, compactNumber } from '../lib/format';
import { Badge, Card, CardHeader, EmptyState, FullPageSpinner, IconChip, PageHeader } from '../components/ui';
import { useToast } from '../components/ui/Toast';

// Business Growth (2026-10-03, CLAUDE.md #73) — the owner's own ask: "kuna
// feature 1 naomba tuiweke ambayo ni business growth... ili mteja asije
// kuona aingiz faida yote na kufunga biashara" (an analysis + advice page
// across every issue, so the client doesn't conclude they're making no
// profit and close the business). Everything on this page is derived from
// the shop's own real history server-side (businessGrowth.service.ts) —
// rule-based, not an LLM call (same pattern as the Reports page's "Quick
// Insights" and the narrative PDF, CLAUDE.md #64), and the "expected
// revenue" baseline is auto-computed from the shop's own past weeks, since
// this system has no manual sales-targets feature (both confirmed with the
// owner before writing any code).
export default function BusinessGrowthPage() {
  const [data, setData] = useState<BusinessGrowthAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    businessGrowthApi
      .get()
      .then((res) => {
        if (active) setData(res.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load Business Growth analysis.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <FullPageSpinner />;
  if (!data) return <EmptyState title="Could not load Business Growth analysis." />;

  const { week, weeklyTrend, issues } = data;

  const severityOrder: GrowthIssueSeverity[] = ['critical', 'warning', 'info', 'positive'];
  const groupedIssues = severityOrder
    .map((sev) => ({ sev, items: issues.filter((i) => i.severity === sev) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader
        title="Business Growth"
        subtitle={`As of ${formatDate(week.start)} week, day ${week.daysElapsed}`}
        icon={<TrendingUp size={20} />}
      />

      <WeekStatusHero week={week} />

      <Card className="mt-6">
        <CardHeader
          title="Weekly Revenue Trend"
          subtitle={
            week.baselineWeeksUsed > 0
              ? `Dashed line marks this shop's usual full-week revenue, averaged over its last ${week.baselineWeeksUsed} complete week${week.baselineWeeksUsed === 1 ? '' : 's'}.`
              : 'Still building history — the usual-week line will appear once a couple of complete weeks have passed.'
          }
        />
        <div className="p-5">
          <WeeklyTrendChart trend={weeklyTrend} baselineFullWeek={weekBaselineFullWeek(week)} />
        </div>
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 font-display font-bold text-slate-800 dark:text-[#eef3ef]">Issues &amp; Advice</h2>
        {groupedIssues.length === 0 ? (
          <EmptyState title="No issues flagged right now." />
        ) : (
          <div className="flex flex-col gap-4">
            {groupedIssues.map((g) => (
              <div key={g.sev} className="flex flex-col gap-3">
                {g.items.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// week.expectedToDate is already prorated to today's day-of-week offset (a
// fair partial-week comparison) — this reconstructs the full-week figure
// implied by that same baseline, purely for the chart's reference line, so
// the line reads as "a normal Monday-Sunday", not "a normal Monday-Wednesday".
function weekBaselineFullWeek(week: BusinessGrowthAnalysis['week']): number | null {
  if (week.expectedToDate === null || week.daysElapsed <= 0) return null;
  return (week.expectedToDate / week.daysElapsed) * 7;
}

const STATUS_META: Record<
  BusinessGrowthAnalysis['week']['status'],
  { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'slate'; icon: JSX.Element }
> = {
  ahead: { label: 'Ahead of a normal week', tone: 'green', icon: <TrendingUp size={14} /> },
  on_track: { label: 'On track', tone: 'blue', icon: <Minus size={14} /> },
  behind: { label: 'Behind a normal week', tone: 'amber', icon: <TrendingDown size={14} /> },
  critical: { label: 'Well behind a normal week', tone: 'red', icon: <TrendingDown size={14} /> },
  no_baseline: { label: 'Building baseline', tone: 'slate', icon: <Minus size={14} /> },
};

function WeekStatusHero({ week }: { week: BusinessGrowthAnalysis['week'] }) {
  const meta = STATUS_META[week.status];
  return (
    <Card>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-[#97a49b]">
            <span>This week so far ({week.daysElapsed} day{week.daysElapsed === 1 ? '' : 's'} in)</span>
          </div>
          <div className="mt-1 text-3xl font-display font-bold text-slate-800 dark:text-[#eef3ef]">{tzs(week.revenueToDate)}</div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge tone={meta.tone}>
            <span className="inline-flex items-center gap-1">
              {meta.icon}
              {meta.label}
            </span>
          </Badge>
          {week.expectedToDate !== null ? (
            <div className="text-sm text-slate-500 dark:text-[#97a49b]">
              Usual pace for these days: <span className="font-semibold text-slate-700 dark:text-[#d7ddd9]">{tzs(week.expectedToDate)}</span>
              {week.pctOfExpected !== null && ` (${Math.round(week.pctOfExpected)}%)`}
            </div>
          ) : (
            <div className="text-sm text-slate-500 dark:text-[#97a49b]">
              {week.baselineWeeksUsed} complete week{week.baselineWeeksUsed === 1 ? '' : 's'} on record so far
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// Weekly bars, hand-rolled SVG — same mark spec as ReportsPage.tsx's
// DailyChart (rounded data-end, square baseline, recessive gridlines,
// hover title tooltip). This project has no charting library (established
// precedent). The current, still-incomplete week is drawn as a lighter,
// outlined bar (never the same solid fill as a complete week — a partial
// week is not comparable to a full one and shouldn't look like one), and
// the baseline reference is a single dashed line, never a second colored
// series, so no legend is needed for a one-series chart (dataviz skill).
function WeeklyTrendChart({
  trend,
  baselineFullWeek,
}: {
  trend: BusinessGrowthAnalysis['weeklyTrend'];
  baselineFullWeek: number | null;
}) {
  if (trend.length === 0) return <EmptyState title="No weekly data yet." />;

  const width = 640;
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 20, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const n = trend.length;
  const stepX = n > 1 ? innerW / n : innerW;
  const barW = Math.min(32, stepX * 0.6);

  const dataMax = Math.max(...trend.map((t) => t.revenue), baselineFullWeek ?? 0, 1);
  const max = niceMax(dataMax);
  const yFor = (v: number) => padding.top + innerH - (v / max) * innerH;
  const xFor = (i: number) => padding.left + i * stepX + stepX / 2;
  const gridTicks = [0, max / 2, max];

  function barPath(x: number, yTop: number, w: number, yBase: number, r: number) {
    if (yBase - yTop <= 0) return '';
    const radius = Math.min(r, w / 2, yBase - yTop);
    return `M${x},${yBase} L${x},${yTop + radius} Q${x},${yTop} ${x + radius},${yTop} L${x + w - radius},${yTop} Q${x + w},${yTop} ${x + w},${yTop + radius} L${x + w},${yBase} Z`;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {gridTicks.map((t, i) => (
        <g key={`grid-${i}`}>
          <line x1={padding.left} x2={width - padding.right} y1={yFor(t)} y2={yFor(t)} stroke="#E2E8F0" strokeWidth={1} />
          <text x={padding.left - 6} y={yFor(t)} dominantBaseline="middle" fontSize={9} textAnchor="end" fill="#94A3B8">
            {compactNumber(t)}
          </text>
        </g>
      ))}
      {trend.map((wk, i) => {
        const x = xFor(i) - barW / 2;
        const yTop = yFor(wk.revenue);
        const yBase = yFor(0);
        return (
          <path
            key={wk.weekStart}
            d={barPath(x, yTop, barW, yBase, 3)}
            fill={wk.isPartial ? 'none' : '#0f9d58'}
            stroke={wk.isPartial ? '#0f9d58' : 'none'}
            strokeWidth={wk.isPartial ? 1.5 : 0}
            strokeDasharray={wk.isPartial ? '3,3' : undefined}
          >
            <title>{`Week of ${formatDate(wk.weekStart)}${wk.isPartial ? ' (so far)' : ''}: ${tzs(wk.revenue)}`}</title>
          </path>
        );
      })}
      {baselineFullWeek !== null && (
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={yFor(baselineFullWeek)}
          y2={yFor(baselineFullWeek)}
          stroke="#2a78d6"
          strokeWidth={1.5}
          strokeDasharray="5,4"
        />
      )}
      <line x1={padding.left} x2={width - padding.right} y1={yFor(0)} y2={yFor(0)} stroke="#CBD5E1" strokeWidth={1} />
      {trend.map((wk, i) => {
        const labelEvery = Math.max(1, Math.ceil(n / 6));
        if (i % labelEvery !== 0 && i !== n - 1) return null;
        const isFirst = i === 0;
        const isLast = i === n - 1;
        return (
          <text
            key={`lbl-${wk.weekStart}`}
            x={xFor(i)}
            y={height - 4}
            fontSize={9}
            textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
            fill="#94A3B8"
          >
            {formatDate(wk.weekStart).slice(0, 6)}
          </text>
        );
      })}
    </svg>
  );
}

function niceMax(dataMax: number): number {
  if (dataMax <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
  const normalized = dataMax / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

const SEVERITY_META: Record<GrowthIssueSeverity, { tone: 'green' | 'blue' | 'amber' | 'red' | 'slate'; icon: JSX.Element }> = {
  critical: { tone: 'red', icon: <XCircle size={18} /> },
  warning: { tone: 'amber', icon: <AlertTriangle size={18} /> },
  info: { tone: 'blue', icon: <Lightbulb size={18} /> },
  positive: { tone: 'green', icon: <CheckCircle2 size={18} /> },
};

const CATEGORY_LINK: Record<GrowthIssueCategory, { to: string; icon: JSX.Element } | null> = {
  revenue: { to: '/reports', icon: <BarChart3 size={12} /> },
  stock: { to: '/inventory', icon: <Boxes size={12} /> },
  debt: { to: '/sales-history', icon: <Wallet size={12} /> },
  pricing: { to: '/reports', icon: <Tag size={12} /> },
  margin: { to: '/reports', icon: <Package size={12} /> },
};

function IssueCard({ issue }: { issue: GrowthIssue }) {
  const meta = SEVERITY_META[issue.severity];
  const link = CATEGORY_LINK[issue.category];
  return (
    <Card>
      <div className="flex gap-4 p-5">
        <IconChip tone={meta.tone} icon={meta.icon} size={40} />
        <div className="flex-1">
          <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">{issue.title}</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-[#b6c2ba]">{issue.detail}</p>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-500 dark:text-[#97a49b]">
            <Lightbulb size={14} className="mt-0.5 shrink-0 text-amber-500" />
            <span>{issue.advice}</span>
          </p>
          {link && (
            <Link
              to={link.to}
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:underline dark:text-green-400"
            >
              {link.icon}
              View details
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
