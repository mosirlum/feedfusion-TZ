import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  XCircle,
  Lightbulb,
  CheckCircle2,
  Minus,
  RefreshCw,
  Package,
  Wallet,
  Tag,
  BarChart3,
  Boxes,
} from 'lucide-react';
import { businessGrowthApi, apiErrorMessage } from '../lib/api';
import { BusinessGrowthAnalysis, BusinessGrowthDetails, GrowthIssue, GrowthIssueCategory, GrowthIssueSeverity } from '../types';
import { tzs, formatDate } from '../lib/format';
import { Badge, Button, Card, EmptyState, IconChip, PageHeader, Skeleton } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import {
  AttentionTiles,
  CustomersSection,
  DetailsSkeleton,
  ReorderSection,
  SlowMovingSection,
  TrendSection,
} from '../components/growth/GrowthDetails';

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
// 2026-10-09: the page now has two independent loads — the advice cards
// (/business-growth, the original analysis) and the detail tables
// (/business-growth/details: trend, reorder, slow-moving, customers). Either
// can fail or be slow without blanking the other.
export default function BusinessGrowthPage() {
  const [data, setData] = useState<BusinessGrowthAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<BusinessGrowthDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [detailsFailed, setDetailsFailed] = useState(false);
  const toast = useToast();

  const loadDetails = useCallback(() => {
    setDetailsLoading(true);
    setDetailsFailed(false);
    let cancelled = false;
    businessGrowthApi
      .details()
      .then((res) => !cancelled && setDetails(res.data))
      .catch((err) => {
        if (cancelled) return;
        setDetailsFailed(true);
        toast.error(apiErrorMessage(err, 'Could not load the detail sections.'));
      })
      .finally(() => !cancelled && setDetailsLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    businessGrowthApi
      .get()
      .then((res) => {
        if (active) setData(res.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load Business Growth analysis.')))
      .finally(() => active && setLoading(false));
    const cancelDetails = loadDetails();
    return () => {
      active = false;
      cancelDetails();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <PageSkeleton />;
  if (!data) return <EmptyState title="Could not load Business Growth analysis." description="Check your connection and refresh the page." />;

  const { week, issues } = data;

  const severityOrder: GrowthIssueSeverity[] = ['critical', 'warning', 'info', 'positive'];
  const orderedIssues = severityOrder.flatMap((sev) => issues.filter((i) => i.severity === sev));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Business Growth"
        subtitle={`Week of ${formatDate(week.start)} · day ${week.daysElapsed} of 7`}
        icon={<TrendingUp size={20} />}
        action={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={() => { void businessGrowthApi.get().then((r) => setData(r.data)).catch((e) => toast.error(apiErrorMessage(e, 'Refresh failed.'))); loadDetails(); }}>
            Refresh
          </Button>
        }
      />

      <WeekStatusHero week={week} />

      <AttentionTiles details={details} week={week} />

      <section aria-labelledby="issues-title">
        <h2 id="issues-title" className="mb-3 font-display font-bold text-slate-800 dark:text-[#eef3ef]">
          Issues &amp; advice
        </h2>
        {orderedIssues.length === 0 ? (
          <Card>
            <EmptyState icon={<CheckCircle2 size={28} />} title="No issues flagged right now." description="Nothing in sales, stock, pricing or credit needs attention." />
          </Card>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {orderedIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        )}
      </section>

      {detailsLoading && !details ? (
        <DetailsSkeleton />
      ) : detailsFailed || !details ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle size={28} />}
            title="Couldn't load trends, reorder list and customers."
            description="The advice above is still up to date. Try again in a moment."
            action={<Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={loadDetails}>Try again</Button>}
          />
        </Card>
      ) : (
        <>
          <TrendSection details={details} week={week} />
          <ReorderSection data={details.reorder} />
          <SlowMovingSection data={details.slowMoving} />
          <CustomersSection data={details.customers} />
        </>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading Business Growth">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-40 rounded-card" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[124px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-card" />
    </div>
  );
}

const STATUS_META: Record<
  BusinessGrowthAnalysis['week']['status'],
  { label: string; icon: JSX.Element; chip: string }
> = {
  ahead: { label: 'Ahead of a normal week', icon: <TrendingUp size={14} />, chip: 'bg-green-400/20 text-green-100' },
  on_track: { label: 'On track', icon: <Minus size={14} />, chip: 'bg-blue-300/20 text-blue-100' },
  behind: { label: 'Behind a normal week', icon: <TrendingDown size={14} />, chip: 'bg-amber-300/25 text-amber-100' },
  critical: { label: 'Well behind a normal week', icon: <TrendingDown size={14} />, chip: 'bg-danger-300/30 text-red-100' },
  no_baseline: { label: 'Building baseline', icon: <Minus size={14} />, chip: 'bg-white/15 text-white/90' },
};

function WeekStatusHero({ week }: { week: BusinessGrowthAnalysis['week'] }) {
  const meta = STATUS_META[week.status];
  const pct = week.pctOfExpected !== null ? Math.max(0, Math.round(week.pctOfExpected)) : null;
  return (
    <section aria-label="This week so far" className="overflow-hidden rounded-card bg-brand-gradient p-5 text-white shadow-panel sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-green-100/80">
            This week so far · {week.daysElapsed} day{week.daysElapsed === 1 ? '' : 's'} in
          </p>
          <p className="mt-1 font-display text-3xl font-extrabold tabular-nums sm:text-4xl">{tzs(week.revenueToDate)}</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${meta.chip}`}>
            {meta.icon}
            {meta.label}
          </span>
          {week.expectedToDate !== null ? (
            <p className="text-sm text-green-100/80">
              Usual pace for these days: <span className="font-semibold text-white tabular-nums">{tzs(week.expectedToDate)}</span>
            </p>
          ) : (
            <p className="text-sm text-green-100/80">
              {week.baselineWeeksUsed} complete week{week.baselineWeeksUsed === 1 ? '' : 's'} on record so far
            </p>
          )}
        </div>
      </div>
      {pct !== null && (
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-green-100/80">
            <span>{pct}% of a normal week so far</span>
            <span>100% = usual pace</span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-label="Progress against a normal week">
            <div className="h-full rounded-full bg-green-300 transition-[width] duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

const SEVERITY_META: Record<GrowthIssueSeverity, { tone: 'green' | 'blue' | 'amber' | 'red' | 'slate'; icon: JSX.Element; label: string }> = {
  critical: { tone: 'red', icon: <XCircle size={18} />, label: 'Urgent' },
  warning: { tone: 'amber', icon: <AlertTriangle size={18} />, label: 'Watch' },
  info: { tone: 'blue', icon: <Lightbulb size={18} />, label: 'Tip' },
  positive: { tone: 'green', icon: <CheckCircle2 size={18} />, label: 'Good news' },
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
      <article className="flex gap-4 p-5">
        <IconChip tone={meta.tone} icon={meta.icon} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">{issue.title}</h3>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-[#b6c2ba]">{issue.detail}</p>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-[#0e1512] dark:text-[#b6c2ba]">
            <Lightbulb size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            <span>{issue.advice}</span>
          </p>
          {link && (
            <Link
              to={link.to}
              className="mt-3 inline-flex items-center gap-1 rounded text-sm font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400"
            >
              {link.icon}
              View details
            </Link>
          )}
        </div>
      </article>
    </Card>
  );
}
