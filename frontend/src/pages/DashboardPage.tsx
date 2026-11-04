import clsx from 'clsx';
import { CSSProperties, ReactNode, useEffect, useState } from 'react';
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
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { dashboardApi, apiErrorMessage } from '../lib/api';
import { DashboardToday } from '../types';
import { tzs, formatDate } from '../lib/format';
import { useElementWidth } from '../lib/useElementWidth';
import { useAuth } from '../context/AuthContext';
import { useCountUp } from '../lib/useCountUp';
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
  const { user } = useAuth();

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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0];
  const lowNames = data.lowStockProducts.slice(0, 3).map((p) => p.name).filter(Boolean);
  const overdue = data.outstandingDebt.overdueCount;
  const overdueAmount = data.outstandingDebt.topDebtors.filter((d) => d.is_overdue).reduce((sum, d) => sum + d.balance_due, 0);
  const allClear = !data.lowStockAlert && data.outstandingDebt.debtorCount === 0;
  const maxTop = Math.max(1, ...topProductSlices.map((t) => t.value));
  const weekSales = data.trend.reduce((sum, t) => sum + t.sales, 0);
  const weekPurchases = data.trend.reduce((sum, t) => sum + t.purchases, 0);

  // Dashboard redesign (2026-11-04, CLAUDE.md #89) — the owner called the old
  // dashboard "awful": a long stack of same-weight white cards with the things
  // that need action (overdue debt, stock running out) buried halfway down and
  // a small chart with unreadable axis labels. Same data and endpoints, new
  // order and shape: greeting + the two actions he does all day in the header;
  // sales hero with its 7-day trend; a "Needs your attention" card beside it;
  // then the big chart next to profit & loss; then money owed, best sellers
  // and stock health; recent purchases last.
  return (
    <div>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">{formatDate(data.date)}</p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-800 dark:text-[#f4f8f5] sm:text-[1.7rem]">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/pos"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white shadow-card transition-colors hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 sm:flex-none"
          >
            <ShoppingCart size={16} aria-hidden="true" /> New sale
          </Link>
          <Link
            to="/purchases"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:border-[rgba(255,255,255,0.14)] dark:bg-transparent dark:text-[#d2dbd5] dark:hover:bg-[#17211c] sm:flex-none"
          >
            <Truck size={16} aria-hidden="true" /> New purchase
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Sales hero */}
        <section aria-label="Today at a glance" className="relative overflow-hidden flex flex-col rounded-card bg-brand-gradient p-5 text-white shadow-panel sm:p-6 xl:col-span-8 ff-rise" style={dly(80)}>
          <div className="grid gap-5 sm:grid-cols-[1fr_minmax(0,1fr)] sm:items-start">
            <div>
              <p className="text-sm text-green-100/80">Sales today</p>
              <p className="mt-1 font-display text-3xl font-extrabold tabular-nums sm:text-[2.6rem] sm:leading-none"><CountTzs value={data.totalSales} />
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-green-100/80">
                <span>
                  {data.transactionCount} sale{data.transactionCount === 1 ? '' : 's'}
                </span>
                <HeroDelta pct={data.deltas.totalSales} />
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between text-xs text-green-100/70">
                <span>Last 7 days</span>
                <span className="font-semibold tabular-nums text-green-50">{tzs(weekSales)}</span>
              </div>
              <HeroSparkline trend={data.trend} />
            </div>
          </div>
          <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
            <HeroStat label="Gross profit" value={<CountTzs value={data.grossProfit} />} pct={data.deltas.grossProfit} />
            <HeroStat label="Expenses" value={<CountTzs value={data.expenses} />} pct={data.deltas.expenses} invert />
            <HeroStat label="Estimated net" value={<CountTzs value={data.estimatedNet} />} pct={data.deltas.estimatedNet} negative={data.estimatedNet < 0} />
          </dl>
        </section>

        {/* Needs attention */}
        <Card className="ff-rise flex flex-col p-5 xl:col-span-4" style={dly(200)}>
          <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Needs your attention</h3>
          <div className="mt-3 flex flex-1 flex-col gap-2.5">
            {overdue > 0 && (
              <AttentionRow
                to="/sales-history"
                tone="red"
                icon={<AlertTriangle size={16} />}
                title={`${overdue} overdue payment${overdue === 1 ? '' : 's'}`}
                detail={`${tzs(overdueAmount)} should already have been paid`}
              />
            )}
            {data.outstandingDebt.debtorCount > overdue && (
              <AttentionRow
                to="/sales-history"
                tone="amber"
                icon={<HandCoins size={16} />}
                title={`${data.outstandingDebt.debtorCount - overdue} unpaid credit sale${data.outstandingDebt.debtorCount - overdue === 1 ? '' : 's'}`}
                detail="Not yet due"
              />
            )}
            {data.lowStockAlert && (
              <AttentionRow
                to="/inventory"
                tone="amber"
                icon={<PackageX size={16} />}
                title={`${data.lowStockCount} product${data.lowStockCount === 1 ? '' : 's'} low or out of stock`}
                detail={lowNames.length > 0 ? lowNames.join(', ') : 'Open inventory to restock'}
              />
            )}
            {allClear && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <CheckCircle2 size={30} className="text-green-600 dark:text-green-400" aria-hidden="true" />
                <p className="font-semibold text-slate-700 dark:text-[#d2dbd5]">All clear</p>
                <p className="text-sm text-slate-500 dark:text-[#97a49b]">Stock is healthy and nobody owes you money.</p>
              </div>
            )}
          </div>
        </Card>

        {/* Big chart */}
        <Card className="ff-rise p-5 xl:col-span-8" style={dly(340)}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-green-600 dark:text-green-400" />
              <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Sales vs purchases</h3>
            </div>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:bg-[#0e1512] dark:text-[#97a49b]">Last 7 days</span>
          </div>
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium text-slate-500 dark:text-[#97a49b]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: '#1f9e5d' }} />
              Sales <b className="text-slate-800 dark:text-[#eef3ef]">{tzs(weekSales)}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: '#2a78d6' }} />
              Purchases <b className="text-slate-800 dark:text-[#eef3ef]">{tzs(weekPurchases)}</b>
            </span>
          </div>
          <SalesPurchasesChart trend={data.trend} />
        </Card>

        {/* Profit & loss */}
        <Card className="ff-rise flex flex-col xl:col-span-4" style={dly(460)}>
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">
            <div className="flex items-center gap-3">
              <IconChip tone="green" size={34} icon={<Wallet size={16} />} />
              <div className="min-w-0">
                <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Profit &amp; loss</h3>
                <p className="truncate text-sm text-slate-500 dark:text-[#97a49b]">{plPeriodLabel}</p>
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
            <div className="flex flex-1 flex-col justify-center gap-4 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Net profit</p>
                <p className={clsx('mt-1 font-display text-3xl font-extrabold tabular-nums', plFigures.netProfit >= 0 ? 'text-green-700 dark:text-green-300' : 'text-danger-600 dark:text-danger-300')}>
                  <CountTzs value={plFigures.netProfit} />
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 dark:bg-[#0e1512]">
                <div>
                  <dt className="text-xs text-slate-500 dark:text-[#97a49b]">Gross profit</dt>
                  <dd className="mt-0.5 font-display font-bold tabular-nums text-slate-700 dark:text-[#dbe6de]">{tzs(plFigures.grossProfit)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-[#97a49b]">Expenses</dt>
                  <dd className="mt-0.5 font-display font-bold tabular-nums text-slate-700 dark:text-[#dbe6de]">{tzs(plFigures.expenses)}</dd>
                </div>
              </dl>
              <Link to="/business-growth" className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400">
                Are we growing? See month by month <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <p className="p-5 text-sm text-slate-500 dark:text-[#97a49b]">Pick the dates above and choose “Show profit”.</p>
          )}
        </Card>

        {/* Left column: money owed + recent purchases (balances the right column) */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
        {/* Money owed */}
        <Card className="ff-rise" style={dly(580)}>
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <IconChip tone="amber" size={34} icon={<HandCoins size={16} />} />
              <div>
                <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Money owed to you</h3>
                <p className="text-sm text-slate-500 dark:text-[#97a49b]">Credit sales not fully paid yet</p>
              </div>
            </div>
            <Link to="/sales-history" className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400">
              Sales History <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {data.outstandingDebt.debtorCount === 0 ? (
            <EmptyState icon={<BadgeCheck size={28} />} title="No outstanding customer debt right now." description="Every credit sale has been paid." />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 pt-4">
                <p className="font-display text-2xl font-extrabold tabular-nums text-amber-600 dark:text-amber-300"><CountTzs value={data.outstandingDebt.totalOutstanding} /></p>
                <p className="text-sm text-slate-500 dark:text-[#97a49b]">
                  across {data.outstandingDebt.debtorCount} unpaid sale{data.outstandingDebt.debtorCount === 1 ? '' : 's'}
                </p>
                {/* Overdue (2026-09-25, migration 021) — the in-app alert the
                    owner asked for instead of external SMS/WhatsApp. */}
                {overdue > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2.5 py-0.5 text-xs font-bold text-danger-600 dark:bg-danger-900/40 dark:text-danger-300">
                    <AlertTriangle size={12} aria-hidden="true" /> {overdue} overdue
                  </span>
                )}
              </div>
              <ul className="mt-2 divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)]">
                {visibleDebtors.map((d) => (
                  <li key={d.id} className="flex flex-col gap-1 px-5 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-[#0e1512]/40 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800 dark:text-[#eef3ef]">
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
              {debtors.length > 5 && (
                <div className="border-t border-slate-100 px-5 py-3 text-sm dark:border-[rgba(255,255,255,0.08)]">
                  <button
                    type="button"
                    onClick={() => setShowAllDebtors((v) => !v)}
                    className="rounded font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400"
                  >
                    {showAllDebtors ? 'Show fewer' : `Show ${debtors.length - 5} more of ${data.outstandingDebt.debtorCount}`}
                  </button>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Recent purchases */}
        <Card className="ff-rise" style={dly(700)}>
          <CardHeader
            title="Recent purchases"
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
                  <Th className="hidden text-right sm:table-cell">Items</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <tbody>
                {/* No Status column: this schema has no per-purchase status
                    (every purchase is simply "recorded"), so a constant badge
                    would be decoration, not data. */}
                {data.recentPurchases.map((p) => (
                  <Tr key={p.id}>
                    <Td className="whitespace-nowrap text-slate-500 dark:text-[#97a49b]">{formatDate(p.purchase_date)}</Td>
                    <Td className="font-semibold text-slate-800 dark:text-[#eef3ef]">{p.supplier_name}</Td>
                    <Td className="hidden text-right sm:table-cell">{p.item_count}</Td>
                    <Td className="text-right font-medium">{tzs(p.total_cost)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        </div>

        {/* Best sellers + stock health */}
        <div className="flex flex-col gap-4 xl:col-span-5">
          <Card className="ff-rise p-5" style={dly(640)}>
            <div className="mb-3 flex items-center gap-2">
              <Tag size={16} className="text-green-600 dark:text-green-400" />
              <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Best sellers today</h3>
            </div>
            {topProductSlices.length === 0 ? (
              <p className="py-3 text-sm text-slate-500 dark:text-[#97a49b]">No sales recorded yet today.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {topProductSlices.map((t, idx) => (
                  <li key={t.name}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-[#d2dbd5]">{t.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-500 dark:text-[#97a49b]">
                        {tzs(t.value)} <b className="ml-1 text-slate-800 dark:text-[#eef3ef]">{t.pct.toFixed(0)}%</b>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-[#0e1512]">
                      <div className="ff-grow-x h-full rounded-full" style={{ ...dly(1000 + idx * 160), width: `${Math.max(3, (t.value / maxTop) * 100)}%`, background: t.color }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {topProduct && (
              <p className="mt-4 flex gap-2 rounded-xl bg-green-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-green-900/20 dark:text-[#b6c2ba]">
                <Lightbulb size={15} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
                <span>
                  <b>{topProduct.product_name}</b> has the highest demand today ({topProduct.quantity_sold} sold). Keep an eye on its stock level.
                </span>
              </p>
            )}
          </Card>

          <Card className="ff-rise p-5" style={dly(900)}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Boxes size={16} className="text-green-600 dark:text-green-400" />
                <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Stock health</h3>
              </div>
              <Link to="/inventory" className="inline-flex items-center text-sm font-semibold text-green-700 hover:underline dark:text-green-400">
                Inventory <ChevronRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${data.stockStatusCounts.inStock} in stock, ${data.stockStatusCounts.lowStock} low, ${data.stockStatusCounts.outOfStock} out of stock`}>
              {stockSlices
                .filter((sl) => sl.value > 0)
                .map((sl) => (
                  <div key={sl.name} className="ff-grow-x" style={{ ...dly(1000), width: `${sl.pct}%`, background: sl.color }} />
                ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {stockSlices.map((sl) => (
                <div key={sl.name}>
                  <p className="font-display text-xl font-extrabold tabular-nums text-slate-800 dark:text-[#eef3ef]">{sl.value}</p>
                  <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-[#97a49b]">
                    <span className="h-2 w-2 rounded-full" style={{ background: sl.color }} />
                    {sl.name}
                  </p>
                </div>
              ))}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-[rgba(255,255,255,0.08)]">
              <div>
                <dt className="text-xs text-slate-500 dark:text-[#97a49b]">Stock value (at cost)</dt>
                <dd className="mt-0.5 font-display font-bold tabular-nums text-slate-800 dark:text-[#eef3ef]">{tzs(data.currentStockValue)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-[#97a49b]">Purchases today</dt>
                <dd className="mt-0.5 font-display font-bold tabular-nums text-slate-800 dark:text-[#eef3ef]">{tzs(data.totalPurchasesToday)}</dd>
              </div>
            </dl>
          </Card>
        </div>

      </div>
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

// Axis labels: 2.5M / 500K rather than "2500K" (the old labels reached
// "20000K" and were clipped on the left edge).
function fmtK(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${Math.round((v / 1_000_000) * 10) / 10}M`;
  if (a >= 1000) return `${Math.round(v / 1000)}K`;
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
  const H = 260;
  const padL = 40;
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
              <text x={padL - 8} y={ly + 4} textAnchor="end" className="fill-slate-400 dark:fill-[#77857c]" fontSize={11}>
                {v === 0 ? '0' : fmtK(v)}
              </text>
            </g>
          );
        })}

        {trend.map((t, i) => (
          <text key={t.date} x={x(i)} y={H - 4} textAnchor="middle" className="fill-slate-400 dark:fill-[#77857c]" fontSize={11}>
            {shortDate(t.date)}
          </text>
        ))}

        <path className="ff-fade" style={dly(1100)} d={areaPath(purchaseValues)} fill="url(#dashGradBlue)" stroke="none" />
        <path className="ff-draw" pathLength={1} style={dly(500)} d={linePath(purchaseValues)} fill="none" stroke="#2a78d6" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        <path className="ff-fade" style={dly(900)} d={areaPath(salesValues)} fill="url(#dashGradGreen)" stroke="none" />
        <path className="ff-draw" pathLength={1} style={dly(400)} d={linePath(salesValues)} fill="none" stroke="#1f9e5d" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />

        {trend.map((t, i) => (
          <g key={t.date}>
            <circle cx={x(i)} cy={y(t.sales)} r={3.2} style={dly(500 + i * 190)} className="ff-dot fill-white dark:fill-[#121a16]" stroke="#1f9e5d" strokeWidth={1.8} />
            <circle cx={x(i)} cy={y(t.purchases)} r={3.2} style={dly(600 + i * 190)} className="ff-dot fill-white dark:fill-[#121a16]" stroke="#2a78d6" strokeWidth={1.8} />
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

function HeroStat({ label, value, pct, negative, invert }: { label: string; value: ReactNode; pct: number | null; negative?: boolean; invert?: boolean }) {
  // `invert`: for expenses, going up is the unwelcome direction.
  const good = pct === null ? null : invert ? pct <= 0 : pct >= 0;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-green-100/80">{label}</dt>
      <dd className={clsx('mt-0.5 whitespace-nowrap font-display text-[0.8rem] font-extrabold tabular-nums min-[420px]:text-base sm:text-lg', negative && 'text-red-200')}>{value}</dd>
      {pct !== null && (
        <dd className={clsx('mt-0.5 text-xs font-semibold tabular-nums', good ? 'text-green-200' : 'text-red-200')}>
          {pct >= 0 ? '↗' : '↘'} {Math.round(Math.abs(pct) * 10) / 10}%
        </dd>
      )}
    </div>
  );
}

/** Animation-delay helper for the shared motion classes in index.css. */
const dly = (ms: number): CSSProperties => ({ ['--d' as string]: `${ms}ms` });

/** TZS amount that counts up from 0 when it first appears. */
function CountTzs({ value }: { value: number }) {
  return <>{tzs(useCountUp(value))}</>;
}

function HeroSparkline({ trend }: { trend: DashboardToday['trend'] }) {
  const vals = trend.map((t) => t.sales);
  const max = Math.max(1, ...vals);
  const n = Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => [(i / n) * 100, 92 - (v / max) * 80] as const);
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px},${py}`).join(' ');
  const last = pts[pts.length - 1] ?? [100, 92];
  return (
    <div className="relative h-[76px] w-full" role="img" aria-label={`Sales over the last 7 days, today ${tzs(vals[vals.length - 1] ?? 0)}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ff-reveal absolute inset-0 h-full w-full overflow-visible" style={dly(500)}>
        <defs>
          <linearGradient id="heroSpark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86efac" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#86efac" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L 100,100 L 0,100 Z`} fill="url(#heroSpark)" />
        <path d={line} fill="none" stroke="#bbf7d0" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span
        className="ff-dot ff-pulse absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-200 ring-4 ring-green-300/25"
        style={{ left: `${last[0]}%`, top: `${last[1]}%`, ...dly(2100) }}
        aria-hidden="true"
      />
    </div>
  );
}

function AttentionRow({ to, tone, icon, title, detail }: { to: string; tone: 'red' | 'amber'; icon: ReactNode; title: string; detail: string }) {
  return (
    <Link
      to={to}
      className={clsx(
        'group flex items-center gap-3 rounded-xl border p-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400',
        tone === 'red'
          ? 'border-red-200 bg-danger-50 hover:bg-danger-100/60 dark:border-danger-900/40 dark:bg-danger-900/20 dark:hover:bg-danger-900/30'
          : 'border-amber-200 bg-amber-50 hover:bg-amber-100/60 dark:border-amber-900/40 dark:bg-amber-900/20 dark:hover:bg-amber-900/30'
      )}
    >
      <IconChip tone={tone} size={32} icon={icon} />
      <div className="min-w-0 flex-1">
        <p className={clsx('text-sm font-bold', tone === 'red' ? 'text-danger-600 dark:text-danger-300' : 'text-amber-800 dark:text-amber-300')}>{title}</p>
        <p className="truncate text-xs text-slate-600 dark:text-[#b6c2ba]">{detail}</p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
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
