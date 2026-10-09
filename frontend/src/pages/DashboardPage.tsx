import clsx from 'clsx';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Receipt,
  Wallet,
  ShoppingBag,
  AlertTriangle,
  PackageX,
  BadgeCheck,
  ArrowRight,
  Plus,
  ShoppingCart,
  Truck,
  BarChart3,
  Lightbulb,
  Layers,
  Tag,
  Boxes,
  Calendar,
  X,
  HandCoins,
} from 'lucide-react';
import { dashboardApi, apiErrorMessage } from '../lib/api';
import { DashboardToday } from '../types';
import { tzs, formatDate } from '../lib/format';
import { useElementWidth } from '../lib/useElementWidth';
import {
  Button,
  Card,
  CardHeader,
  CHART_COLORS,
  DonutChart,
  EmptyState,
  FullPageSpinner,
  IconChip,
  Input,
  PageHeader,
  SegmentedControl,
  StatCard,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';

// Local-date helpers (mirrors SalesHistoryPage.tsx's own localIso/todayLocalIso,
// CLAUDE.md #34). UPDATE (2026-10-01): lib/format.ts's shared todayIso() now
// uses this same local-date field math (the UTC skew these were built to avoid
// is fixed at the source), so these are now redundant rather than a workaround
// — left as-is to keep that fix's blast radius small.
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayLocalIso(): string {
  return localIso(new Date());
}

// Dashboard visual redesign, round 2 (2026-09-12, CLAUDE.md #56/#57) — the
// owner saw the approved mockup again after round 1 shipped and said plainly
// this is what he wants on screen, charts and all, not the pared-down
// "today only" version round 1 shipped. Round 1's judgment call was that the
// mockup's trend chart / donuts / Recent Purchases / Total Purchases / Stock
// Value widgets had no real data behind them — that's no longer true: the
// backend (`dashboard.service.ts`) now computes every one of them for real
// (7-day sales-vs-purchases series, today's purchases total, current stock
// value, a stock-status breakdown, the 5 most recent purchases, and real
// day-over-day % deltas). Nothing on this page is fabricated; two small,
// deliberate omissions remain and are called out where they apply below.
export default function DashboardPage() {
  const [data, setData] = useState<DashboardToday | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // Custom-range Profit & Loss (2026-09-19, CLAUDE.md #69 follow-up) — the
  // owner liked the Yesterday/Last-7-Days cards but asked for a "customize"
  // option too, kept hidden by default so it doesn't clutter the dashboard:
  // "tuwek customize also ila iwe hidden... it can just be a button not a
  // calendar sitting there." So this starts collapsed behind a plain toggle
  // button, not a permanently-visible date picker.
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [plRange, setPlRange] = useState<'yesterday' | 'week' | 'custom'>('yesterday');
  const [showAllDebtors, setShowAllDebtors] = useState(false);
  const [customFrom, setCustomFrom] = useState(todayLocalIso());
  const [customTo, setCustomTo] = useState(todayLocalIso());
  const [customResult, setCustomResult] = useState<{ from: string; to: string; grossProfit: number; expenses: number; netProfit: number } | null>(null);
  const [customLoading, setCustomLoading] = useState(false);

  async function fetchCustomRange() {
    if (!customFrom || !customTo) return;
    if (customFrom > customTo) {
      toast.error('"From" date must not be after "To" date.');
      return;
    }
    setCustomLoading(true);
    try {
      const res = await dashboardApi.profitAndLoss(customFrom, customTo);
      setCustomResult(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not load profit for that range.'));
    } finally {
      setCustomLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    dashboardApi
      .today()
      .then((res) => {
        if (active) setData(res.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load the dashboard.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <FullPageSpinner />;
  if (!data) return <EmptyState title="Could not load dashboard data." />;

  const topProduct = data.topProducts.length > 0 ? [...data.topProducts].sort((a, b) => b.quantity_sold - a.quantity_sold)[0] : null;

  // Top Selling Products donut — real revenue share of today's total sales,
  // top 4 products + an honest "Others" bucket (never more than 5 slices).
  const topProductSlices = buildDonutSlices(
    data.topProducts.map((p) => ({ name: p.product_name, value: Number(p.revenue) })),
    data.totalSales
  );

  // Stock Status donut — real counts across every tracked product (same
  // status logic Inventory/Products use, CLAUDE.md #32), fixed semantic
  // colors (good/warn/crit) rather than the categorical chart palette, since
  // this is a status breakdown, not series identity (dataviz skill: status
  // colors are reserved, never reused for "series N").
  const stockSlices = [
    { name: 'In Stock', value: data.stockStatusCounts.inStock, color: '#1f9e5d' },
    { name: 'Low Stock', value: data.stockStatusCounts.lowStock, color: '#d97706' },
    { name: 'Out of Stock', value: data.stockStatusCounts.outOfStock, color: '#c2402b' },
  ].map((s) => ({ ...s, pct: data.totalProductsTracked > 0 ? (s.value / data.totalProductsTracked) * 100 : 0 }));

  const growthPct = data.deltas.totalSales;
  const plFigures =
    plRange === 'yesterday' ? data.profitAndLoss.yesterday : plRange === 'week' ? data.profitAndLoss.last7Days : customResult;
  const plPeriodLabel =
    plRange === 'yesterday'
      ? 'Net of expenses, for yesterday'
      : plRange === 'week'
        ? 'Net of expenses, for the last 7 days'
        : customResult
          ? `Net of expenses, ${formatDate(customResult.from)} – ${formatDate(customResult.to)}`
          : 'Net of expenses, for dates you choose';

  const debtors = data.outstandingDebt.topDebtors;
  const visibleDebtors = showAllDebtors ? debtors : debtors.slice(0, 5);

  return (
    <div>
      <PageHeader title="Today's Overview" subtitle={formatDate(data.date)} />

      {data.lowStockAlert && (
        <div className="mb-4 flex flex-col gap-2">
          <AlertBanner
            icon={<PackageX size={16} />}
            tone="amber"
            text={`${data.lowStockCount} product${data.lowStockCount === 1 ? '' : 's'} low on stock or out of stock.`}
            action={
              <Link to="/inventory" className="whitespace-nowrap font-semibold underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                View inventory
              </Link>
            }
          />
        </div>
      )}

      {/* Today at a glance (2026-10-09 UI pass) — one hero instead of four
          equal cards: the number the owner checks first (sales) leads, and
          the profit chain (gross → expenses → net) reads left to right. */}
      <section aria-label="Today at a glance" className="overflow-hidden rounded-card bg-brand-gradient p-5 text-white shadow-panel sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr] lg:items-end">
          <div>
            <p className="text-sm text-green-100/80">Total sales today</p>
            <p className="mt-1 font-display text-3xl font-extrabold tabular-nums sm:text-4xl">{tzs(data.totalSales)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-green-100/80">
              <span>
                {data.transactionCount} transaction{data.transactionCount === 1 ? '' : 's'}
              </span>
              <HeroDelta pct={data.deltas.totalSales} />
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-3 border-t border-white/10 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <HeroStat label="Gross profit" value={tzs(data.grossProfit)} pct={data.deltas.grossProfit} />
            <HeroStat label="Expenses" value={tzs(data.expenses)} pct={data.deltas.expenses} invert />
            <HeroStat label="Estimated net" value={tzs(data.estimatedNet)} pct={data.deltas.estimatedNet} negative={data.estimatedNet < 0} />
          </dl>
        </div>
      </section>

      {/* Phone: the three supporting numbers as one compact list card. */}
      <Card className="mt-4 divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)] sm:hidden">
        {[
          { label: 'Total Purchases', hint: 'Recorded today', value: tzs(data.totalPurchasesToday), tone: 'blue' as const, icon: <Truck size={16} /> },
          { label: 'Current Stock Value', hint: 'At current cost', value: tzs(data.currentStockValue), tone: 'purple' as const, icon: <Layers size={16} /> },
          {
            label: 'Low Stock Items',
            hint: data.lowStockCount > 0 ? 'Products need attention' : 'Everything is stocked',
            value: String(data.lowStockCount),
            tone: data.lowStockCount > 0 ? ('amber' as const) : ('green' as const),
            icon: <AlertTriangle size={16} />,
          },
        ].map((k) => (
          <div key={k.label} className="flex items-center gap-3 px-4 py-3.5">
            <div
              className={clsx(
                'rounded-[10px] p-2',
                k.tone === 'blue' && 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
                k.tone === 'purple' && 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
                k.tone === 'amber' && 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                k.tone === 'green' && 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              )}
            >
              {k.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-[#d2dbd5]">{k.label}</p>
              <p className="text-xs text-slate-500 dark:text-[#97a49b]">{k.hint}</p>
            </div>
            <p className="font-display font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{k.value}</p>
          </div>
        ))}
      </Card>

      <div className="mt-4 hidden grid-cols-3 gap-4 sm:grid">
        <StatCard
          label="Total Purchases"
          value={tzs(data.totalPurchasesToday)}
          icon={<Truck size={18} />}
          tone="blue"
          hint="Recorded today"
          delta={deltaProp(data.deltas.totalPurchases)}
        />
        <StatCard label="Current Stock Value" value={tzs(data.currentStockValue)} icon={<Layers size={18} />} tone="purple" hint="At current cost" />
        <StatCard
          label="Low Stock Items"
          value={data.lowStockCount}
          icon={<AlertTriangle size={18} />}
          tone={data.lowStockCount > 0 ? 'amber' : 'green'}
          hint={data.lowStockCount > 0 ? 'Products need attention' : 'Everything is stocked'}
        />
      </div>

      {/* Profit & Loss (CLAUDE.md #69) — Yesterday, Last 7 days and the
          owner's hidden "customize" range (his own request: a button, not a
          calendar sitting there) now share ONE panel behind a switch, instead
          of two cards plus a loose link. Same numbers, same endpoints. */}
      <Card className="mt-4">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <IconChip tone="green" size={34} icon={<Wallet size={16} />} />
            <div>
              <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Profit &amp; loss</h3>
              <p className="text-sm text-slate-500 dark:text-[#97a49b]">{plPeriodLabel}</p>
            </div>
          </div>
          <SegmentedControl
            label="Profit period"
            value={plRange}
            onChange={(v) => {
              setPlRange(v);
              setShowCustomRange(v === 'custom');
            }}
            options={[
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'week', label: 'Last 7 days' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </div>
        {plRange === 'custom' && (
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">
            <div>
              <label htmlFor="pl-from" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-[#97a49b]">From</label>
              <Input id="pl-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} max={customTo} className="w-auto" />
            </div>
            <div>
              <label htmlFor="pl-to" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-[#97a49b]">To</label>
              <Input id="pl-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} min={customFrom} max={todayLocalIso()} className="w-auto" />
            </div>
            <Button size="sm" loading={customLoading} onClick={fetchCustomRange}>
              Show profit
            </Button>
          </div>
        )}
        {plFigures ? (
          <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Net profit</dt>
              <dd className={clsx('mt-1 font-display text-2xl font-extrabold tabular-nums', plFigures.netProfit >= 0 ? 'text-green-700 dark:text-green-300' : 'text-danger-600 dark:text-danger-300')}>
                {tzs(plFigures.netProfit)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Gross profit</dt>
              <dd className="mt-1 font-display text-xl font-bold tabular-nums text-slate-700 dark:text-[#dbe6de]">{tzs(plFigures.grossProfit)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Expenses</dt>
              <dd className="mt-1 font-display text-xl font-bold tabular-nums text-slate-700 dark:text-[#dbe6de]">{tzs(plFigures.expenses)}</dd>
            </div>
          </dl>
        ) : (
          <p className="p-5 text-sm text-slate-500 dark:text-[#97a49b]">Pick the dates above and choose “Show profit”.</p>
        )}
      </Card>

      {/* Outstanding Customer Debt (CLAUDE.md #69 follow-up) — see
          salesRepo.getOutstandingBalances for why oldest-first. Now a list
          (works on a phone) showing the 5 oldest, with the rest one click away. */}
      <Card className="mt-4">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <IconChip tone="amber" size={34} icon={<HandCoins size={16} />} />
            <div>
              <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Outstanding customer debt</h3>
              <p className="text-sm text-slate-500 dark:text-[#97a49b]">Money owed to the shop from credit sales</p>
            </div>
          </div>
          <Link to="/sales-history" className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400">
            View in Sales History <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {data.outstandingDebt.debtorCount === 0 ? (
          <EmptyState icon={<BadgeCheck size={28} />} title="No outstanding customer debt right now." description="Every credit sale has been paid." />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 pt-4">
              <p className="font-display text-2xl font-extrabold tabular-nums text-amber-600 dark:text-amber-300">{tzs(data.outstandingDebt.totalOutstanding)}</p>
              <p className="text-sm text-slate-500 dark:text-[#97a49b]">
                across {data.outstandingDebt.debtorCount} unpaid sale{data.outstandingDebt.debtorCount === 1 ? '' : 's'}
              </p>
              {/* Overdue (2026-09-25, migration 021) — the in-app alert the
                  owner asked for instead of external SMS/WhatsApp. */}
              {data.outstandingDebt.overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2.5 py-0.5 text-xs font-bold text-danger-600 dark:bg-danger-900/40 dark:text-danger-300">
                  <AlertTriangle size={12} aria-hidden="true" /> {data.outstandingDebt.overdueCount} overdue
                </span>
              )}
            </div>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)]">
              {visibleDebtors.map((d) => (
                <li key={d.id} className="flex flex-col gap-1 px-5 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-[#0e1512]/40 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-[#eef3ef]">
                      {d.customer_name || 'Walk-in'}
                      {d.customer_phone && <span className="ml-2 text-sm font-normal text-slate-400 dark:text-[#77857c]">{d.customer_phone}</span>}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-[#97a49b]">
                      {d.invoice_number} · sold {formatDate(d.sale_date)} · total {tzs(d.total)}
                    </p>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 sm:flex-col sm:items-end sm:justify-center sm:gap-0">
                    <p className="font-bold tabular-nums text-amber-600 dark:text-amber-300">{tzs(d.balance_due)}</p>
                    {d.due_date ? (
                      <p className={clsx('text-xs tabular-nums', d.is_overdue ? 'font-bold text-danger-600 dark:text-danger-300' : 'text-slate-500 dark:text-[#97a49b]')}>
                        {d.is_overdue ? 'Overdue since' : 'Due'} {formatDate(d.due_date)}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 dark:text-[#77857c]">no due date</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-sm dark:border-[rgba(255,255,255,0.08)]">
              <span className="text-slate-500 dark:text-[#97a49b]">
                Showing the {visibleDebtors.length} oldest of {data.outstandingDebt.debtorCount} unpaid sales.
              </span>
              {debtors.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllDebtors((v) => !v)}
                  className="rounded font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400"
                >
                  {showAllDebtors ? 'Show fewer' : `Show ${debtors.length - 5} more`}
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr_1fr]">
        <Card className="p-5">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-green-600 dark:text-green-400" />
              <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Sales vs Purchases</h3>
            </div>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:bg-[#0e1512] dark:text-[#97a49b]">
              Last 7 days
            </span>
          </div>
          <div className="mb-2 flex flex-wrap gap-4 text-xs font-medium text-slate-500 dark:text-[#97a49b]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: '#1f9e5d' }} />
              Sales <b className="text-slate-800 dark:text-[#eef3ef]">{tzs(data.trend.reduce((s, t) => s + t.sales, 0))}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: '#2a78d6' }} />
              Purchases <b className="text-slate-800 dark:text-[#eef3ef]">{tzs(data.trend.reduce((s, t) => s + t.purchases, 0))}</b>
            </span>
          </div>
          <SalesPurchasesChart trend={data.trend} />
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Tag size={16} className="text-green-600 dark:text-green-400" />
            <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Top Selling Products</h3>
          </div>
          {topProductSlices.length === 0 ? (
            <EmptyState title="No sales recorded yet today." />
          ) : (
            <div className="flex items-center gap-4">
              <DonutChart slices={topProductSlices} centerValue={tzs(data.totalSales)} centerLabel="Total Sales" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {topProductSlices.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-600 dark:text-[#b6c2ba]">{s.name}</span>
                    <span className="font-bold text-slate-800 dark:text-[#eef3ef]">{s.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Boxes size={16} className="text-green-600 dark:text-green-400" />
            <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Stock Status</h3>
          </div>
          <div className="flex items-center gap-4">
            <DonutChart slices={stockSlices} centerValue={String(data.totalProductsTracked)} centerLabel="Products" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {stockSlices.map((s) => (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-600 dark:text-[#b6c2ba]">{s.name}</span>
                  <span className="font-bold text-slate-800 dark:text-[#eef3ef]">{s.pct.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent Purchases"
            action={
              <Link to="/purchases" className="text-sm font-semibold text-green-700 dark:text-green-400 hover:underline">
                View all
              </Link>
            }
          />
          {data.recentPurchases.length === 0 ? (
            <EmptyState title="No purchases recorded yet." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>Supplier</Th>
                  <Th className="text-right">Items</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <tbody>
                {/* No Status column here, unlike the mockup's "Completed" pill —
                    this schema has no per-purchase status field at all (every
                    purchase is simply "recorded"), so a constant badge on
                    every row would be decoration, not data. */}
                {data.recentPurchases.map((p) => (
                  <Tr key={p.id}>
                    <Td className="whitespace-nowrap text-slate-500 dark:text-[#97a49b]">{formatDate(p.purchase_date)}</Td>
                    <Td className="font-semibold text-slate-800 dark:text-[#eef3ef]">{p.supplier_name}</Td>
                    <Td className="text-right">{p.item_count}</Td>
                    <Td className="text-right font-medium">{tzs(p.total_cost)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Plus size={16} className="text-slate-400 dark:text-[#97a49b]" />
              <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Quick Actions</h3>
            </div>
            <div className="flex flex-col gap-2">
              <QuickAction to="/pos" icon={<ShoppingCart size={16} />} label="New Sale" primary />
              <QuickAction to="/purchases" icon={<Truck size={16} />} label="New Purchase" />
              <QuickAction to="/products" icon={<ShoppingBag size={16} />} label="Products" />
              <QuickAction to="/reports" icon={<BarChart3 size={16} />} label="Reports" />
            </div>
          </Card>

          {topProduct && (
            <div className="flex gap-3 rounded-card border border-green-100 bg-green-50 p-4 dark:border-green-900/40 dark:bg-green-900/20">
              <Lightbulb size={19} className="mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" />
              <div>
                <h4 className="text-sm font-bold text-slate-800 dark:text-[#eef3ef]">Sales Insight</h4>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-[#b6c2ba]">
                  <span className="font-semibold">{topProduct.product_name}</span> has the highest demand today ({topProduct.quantity_sold}{' '}
                  sold). Keep an eye on its stock level.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Growth banner — only shown when there's a real yesterday to compare
          against (deltas.totalSales is null on a day with no prior baseline,
          e.g. this shop's very first recorded day). Never a fabricated
          percentage, and the tone/copy match whichever real direction the
          number moved, not always "growing" like the static mockup. */}
      {growthPct !== null && (
        <div
          className={
            'mt-4 flex flex-wrap items-center gap-4 rounded-card border p-5 ' +
            (growthPct >= 0
              ? 'border-green-100 bg-gradient-to-r from-green-50 to-white dark:border-green-900/30 dark:from-green-900/15 dark:to-transparent'
              : 'border-amber-100 bg-gradient-to-r from-amber-50 to-white dark:border-amber-900/30 dark:from-amber-900/15 dark:to-transparent')
          }
        >
          <IconChip
            tone={growthPct >= 0 ? 'green' : 'amber'}
            size={46}
            icon={growthPct >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
          />
          <div className="flex-1">
            <h4 className="font-display text-[14.5px] font-extrabold text-slate-800 dark:text-[#eef3ef]">
              {growthPct >= 0 ? 'Your business is growing!' : 'Sales dipped a little today'}
            </h4>
            <p className="mt-0.5 text-[12.8px] text-slate-600 dark:text-[#b6c2ba]">
              Total sales {growthPct >= 0 ? 'increased' : 'decreased'} by {Math.abs(growthPct).toFixed(0)}% compared to yesterday.
            </p>
          </div>
          <Link to="/reports">
            <Button variant="outline" size="sm" icon={<ArrowRight size={14} />}>
              View Detailed Report
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-N + "Others" donut bucketing — same pattern as Reports' Sales tab
// (CLAUDE.md #41's buildDonutSlices), kept local here since this is the only
// other page that needs it; worth extracting to components/ui if a third
// page ends up wanting the same thing.
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

function deltaProp(pct: number | null): { value: string; direction: 'up' | 'down' } | undefined {
  if (pct === null) return undefined;
  return { value: `${Math.round(Math.abs(pct) * 10) / 10}%`, direction: pct >= 0 ? 'up' : 'down' };
}

function fmtK(v: number): string {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}K`;
  return String(Math.round(v));
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  const normalized = v / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

// ---------------------------------------------------------------------------
// Sales vs Purchases — hand-rolled SVG area+line chart (this project has no
// charting library, per its own DonutChart precedent). One axis, two series
// sharing it (both are TZS amounts — never a dual-axis chart, per the
// dataviz skill's non-negotiable rule). A per-day hit-rect drives a hover
// crosshair + tooltip, per the dataviz skill's interaction guidance.
// ---------------------------------------------------------------------------
function SalesPurchasesChart({ trend }: { trend: DashboardToday['trend'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width: W } = useElementWidth(640);
  const H = 210;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxRaw = Math.max(1, ...trend.map((t) => Math.max(t.sales, t.purchases)));
  const maxY = niceCeil(maxRaw);
  const stepCount = 4;

  const x = (i: number) => padL + (plotW * i) / Math.max(1, trend.length - 1);
  const y = (v: number) => padT + plotH - (plotH * Math.min(v, maxY)) / maxY;

  function linePath(values: number[]) {
    return values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)},${y(v)}`).join(' ');
  }
  function areaPath(values: number[]) {
    return `${linePath(values)} L ${x(values.length - 1)},${padT + plotH} L ${x(0)},${padT + plotH} Z`;
  }

  const salesValues = trend.map((t) => t.sales);
  const purchaseValues = trend.map((t) => t.purchases);
  const bandW = plotW / Math.max(1, trend.length);
  const hoverRow = hover !== null ? trend[hover] : null;

  return (
    <div ref={ref} className="relative w-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="dashGradGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f9e5d" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#1f9e5d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dashGradBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a78d6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#2a78d6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {Array.from({ length: stepCount + 1 }).map((_, i) => {
          const v = (maxY / stepCount) * i;
          const ly = y(v);
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={ly} y2={ly} className="stroke-slate-100 dark:stroke-[rgba(255,255,255,0.08)]" strokeWidth={1} />
              <text x={0} y={ly + 3} className="fill-slate-400 dark:fill-[#77857c]" fontSize={10}>
                {v === 0 ? '0' : fmtK(v)}
              </text>
            </g>
          );
        })}

        {trend.map((t, i) => (
          <text key={t.date} x={x(i)} y={H - 4} textAnchor="middle" className="fill-slate-400 dark:fill-[#77857c]" fontSize={10}>
            {shortDate(t.date)}
          </text>
        ))}

        <path d={areaPath(purchaseValues)} fill="url(#dashGradBlue)" stroke="none" />
        <path d={linePath(purchaseValues)} fill="none" stroke="#2a78d6" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={areaPath(salesValues)} fill="url(#dashGradGreen)" stroke="none" />
        <path d={linePath(salesValues)} fill="none" stroke="#1f9e5d" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />

        {trend.map((t, i) => (
          <g key={t.date}>
            <circle cx={x(i)} cy={y(t.sales)} r={3.2} className="fill-white dark:fill-[#121a16]" stroke="#1f9e5d" strokeWidth={1.8} />
            <circle cx={x(i)} cy={y(t.purchases)} r={3.2} className="fill-white dark:fill-[#121a16]" stroke="#2a78d6" strokeWidth={1.8} />
          </g>
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padT}
            y2={padT + plotH}
            className="stroke-slate-300 dark:stroke-[rgba(255,255,255,0.2)]"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {trend.map((t, i) => (
          <rect
            key={t.date}
            x={padL + i * bandW}
            y={padT}
            width={bandW}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hoverRow && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-slate-800 px-3 py-2 text-[11.5px] text-white shadow-lg dark:bg-[#0c1310]"
          style={{
            left: `${(x(hover!) / W) * 100}%`,
            top: `${(y(Math.max(hoverRow.sales, hoverRow.purchases)) / H) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 10px))',
          }}
        >
          <div className="mb-1 font-bold opacity-80">{formatDate(hoverRow.date)}</div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#1f9e5d' }} />
            Sales <b className="ml-1">{tzs(hoverRow.sales)}</b>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#2a78d6' }} />
            Purchases <b className="ml-1">{tzs(hoverRow.purchases)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroDelta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', up ? 'bg-green-300/20 text-green-100' : 'bg-danger-300/30 text-red-100')}>
      {up ? '↗' : '↘'} {Math.round(Math.abs(pct) * 10) / 10}% vs yesterday
    </span>
  );
}

function HeroStat({ label, value, pct, negative, invert }: { label: string; value: string; pct: number | null; negative?: boolean; invert?: boolean }) {
  // `invert`: for expenses, going up is the unwelcome direction.
  const good = pct === null ? null : invert ? pct <= 0 : pct >= 0;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-green-100/80">{label}</dt>
      <dd className={clsx('mt-0.5 break-words font-display text-base font-extrabold tabular-nums sm:text-lg', negative && 'text-red-200')}>{value}</dd>
      {pct !== null && (
        <dd className={clsx('mt-0.5 text-xs font-semibold tabular-nums', good ? 'text-green-200' : 'text-red-200')}>
          {pct >= 0 ? '↗' : '↘'} {Math.round(Math.abs(pct) * 10) / 10}%
        </dd>
      )}
    </div>
  );
}

function QuickAction({ to, icon, label, primary }: { to: string; icon: ReactNode; label: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? 'flex items-center gap-2.5 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-green-700'
          : 'flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-[rgba(255,255,255,0.14)] dark:text-[#d2dbd5] dark:hover:bg-[#17211c]'
      }
    >
      {icon}
      {label}
    </Link>
  );
}

function AlertBanner({ icon, text, action, tone }: { icon: ReactNode; text: string; action?: ReactNode; tone: 'amber' | 'red' }) {
  return (
    <div
      className={
        'flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ' +
        (tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300'
          : 'border-red-200 bg-danger-50 text-danger-600 dark:border-danger-900/40 dark:bg-danger-900/20 dark:text-danger-300')
      }
    >
      <IconChip tone={tone === 'amber' ? 'amber' : 'red'} size={30} icon={icon} />
      <span className="flex-1 font-medium">{text}</span>
      {action}
    </div>
  );
}
