import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  History,
  ShoppingCart,
  Receipt,
  Package,
  TrendingUp,
  Search,
  Eye,
  Printer,
  Pencil,
  Ban,
  Wallet,
  Landmark,
  Smartphone,
  HandCoins,
  Calendar,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  TriangleAlert,
} from 'lucide-react';
import { salesApi, productsApi, apiErrorMessage } from '../lib/api';
import { Sale, SalesStats, Product, PaymentMethod } from '../types';
import { tzs, formatDateTime, formatDate, pageWindow } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
  Table,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { ReceiptView } from '../components/ReceiptView';
import { EditSaleModal } from '../components/sales/EditSaleModal';

const PAGE_SIZE = 10;

// Local-calendar-date helpers (2026-09-11). UPDATE (2026-10-01): the shared
// todayIso()/isoDaysAgo() in lib/format.ts have since been fixed to use the
// same local-date field math as these two (no more UTC round-trip skew for
// Tanzania's UTC+3), so this page's own copies below are now redundant with
// the shared helpers rather than a workaround for them. Left in place rather
// than consolidated, to keep that fix's blast radius small — safe to switch
// this page over to the shared helpers later if wanted.
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthStartLocalIso(): string {
  const d = new Date();
  return localIso(new Date(d.getFullYear(), d.getMonth(), 1));
}
function todayLocalIso(): string {
  return localIso(new Date());
}

// Invoice print tracking (2026-09-12, CLAUDE.md #47) — "track & warn only":
// a sale stays fully COMPLETED/PAID the moment it's rung up either way
// (BR-04 unchanged); this is purely a paperwork indicator. Flags anything
// unprinted for 7+ days so the owner notices, without blocking anything.
const UNPRINTED_WARNING_DAYS = 7;

function PrintedIndicator({ sale }: { sale: Sale }) {
  if (sale.printed_at) {
    return (
      <span className="text-[10.5px] text-slate-400 dark:text-[#77857c]" title={formatDateTime(sale.printed_at)}>
        Printed
      </span>
    );
  }
  const daysSince = Math.floor((Date.now() - new Date(sale.sale_date).getTime()) / (1000 * 60 * 60 * 24));
  const overdue = daysSince >= UNPRINTED_WARNING_DAYS;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-[10.5px] font-medium',
        overdue ? 'text-danger-600' : 'text-slate-400 dark:text-[#77857c]'
      )}
      title={overdue ? `Not printed for ${daysSince} days` : 'Not printed yet'}
    >
      {overdue && <TriangleAlert size={11} />}
      Not printed yet
    </span>
  );
}

// Real payment method(s), not the old hardcoded "Cash" pill (2026-09-12,
// CLAUDE.md #50) — shows the most recent payment's method (a bank/mobile
// top-up on a PARTIAL sale is what a staff member most wants to see at a
// glance), with a "+N" hint when more than one distinct method was used.
const METHOD_META: Record<string, { label: string; icon: typeof Wallet }> = {
  CASH: { label: 'Cash', icon: Wallet },
  BANK_TRANSFER: { label: 'Bank', icon: Landmark },
  MOBILE_MONEY: { label: 'Mobile', icon: Smartphone },
};
function PaymentMethodBadge({ sale }: { sale: Sale }) {
  const meta = METHOD_META[sale.last_payment_method ?? 'CASH'];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-[#0e1512] dark:text-[#b6c2ba]">
      <meta.icon size={12} /> {meta.label}
      {(sale.payment_method_count ?? 1) > 1 && ` +${(sale.payment_method_count ?? 1) - 1}`}
    </span>
  );
}

function TrendHint({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-slate-400 dark:text-[#77857c]">No sales in the previous period</span>;
  }
  const up = pct >= 0;
  return (
    <span className={up ? 'text-green-600 dark:text-green-400' : 'text-danger-600 dark:text-danger-300'}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}% vs previous period
    </span>
  );
}

// Sales History redesign (2026-09-11, CLAUDE.md #34) — from a fourth
// reference screenshot. See CLAUDE.md for the judgment calls: opening this
// page to sales/manager roles (scoped to their own sales) while keeping
// Total Profit owner-only (BR-24), the real "vs previous period" comparison,
// and why the mockup's Mobile Money/Bank Transfer payment method never
// appears (this system is cash-only, per the New Sale redesign's decision).
export default function SalesHistoryPage() {
  const { isOwner } = useAuth();
  const toast = useToast();

  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<SalesStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState(monthStartLocalIso());
  const [to, setTo] = useState(todayLocalIso());
  const [statusFilter, setStatusFilter] = useState<'all' | 'COMPLETED' | 'VOIDED'>('all');
  const [productFilter, setProductFilter] = useState<'all' | number>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [viewSaleId, setViewSaleId] = useState<number | null>(null);
  const [editSaleId, setEditSaleId] = useState<number | null>(null);
  const [voidSale, setVoidSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Record a follow-up payment against a PARTIAL sale's balance (2026-09-12,
  // credit sales, CLAUDE.md #50) — "mzigo unatoka sasa, malipo yanakuja
  // baadaye."
  const [paySale, setPaySale] = useState<Sale | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [paying, setPaying] = useState(false);

  // Debounced search — this hits the database (invoice number, customer
  // name, and a join to sale_items/products), unlike Products/Inventory's
  // client-side filtering over an already-fetched list, so it's worth not
  // firing on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  function load() {
    setLoading(true);
    const params = {
      from,
      to,
      status: statusFilter === 'all' ? undefined : statusFilter,
      product_id: productFilter === 'all' ? undefined : productFilter,
      search: search || undefined,
    };
    Promise.all([salesApi.list(params), salesApi.stats({ from, to })])
      .then(([salesRes, statsRes]) => {
        setSales(salesRes.data);
        setStats(statsRes.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load sales history.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    productsApi.list().then((res) => setProducts(res.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, productFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [from, to, statusFilter, productFilter, search]);

  // Invoice print tracking (2026-09-12, CLAUDE.md #47) — non-blocking:
  // window.print() always fires regardless of whether the mark-printed call
  // succeeds. Updates the row's badge locally rather than a full reload.
  async function handlePrint(saleId: number) {
    try {
      const res = await salesApi.markPrinted(saleId);
      setSales((prev) => prev.map((s) => (s.id === saleId ? { ...s, printed_at: res.data.printed_at } : s)));
    } catch {
      // Printing itself must never be blocked by this.
    }
    window.print();
  }

  async function confirmPayment() {
    if (!paySale) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter an amount greater than zero.');
      return;
    }
    setPaying(true);
    try {
      const res = await salesApi.recordPayment(paySale.id, { amount, method: payMethod });
      toast.success(
        res.data.payment_status === 'PAID' ? 'Balance settled — sale is now fully paid.' : `Payment recorded — ${tzs(res.data.balance_due)} still owed.`
      );
      setSales((prev) => prev.map((s) => (s.id === paySale.id ? res.data : s)));
      setPaySale(null);
      setPayAmount('');
      setPayMethod('CASH');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not record this payment.'));
    } finally {
      setPaying(false);
    }
  }

  async function confirmVoid() {
    if (!voidSale || !voidReason.trim()) {
      toast.error('A reason is required to void a sale.');
      return;
    }
    setVoiding(true);
    try {
      await salesApi.void(voidSale.id, voidReason.trim());
      toast.success(`Sale ${voidSale.invoice_number} voided.`);
      setVoidSale(null);
      setVoidReason('');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not void this sale.'));
    } finally {
      setVoiding(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(sales.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = sales.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const filtersActive = statusFilter !== 'all' || productFilter !== 'all' || search !== '';

  function setQuickRange(kind: 'today' | 'week' | 'month') {
    const now = new Date();
    setTo(todayLocalIso());
    if (kind === 'today') setFrom(todayLocalIso());
    else if (kind === 'week') setFrom(localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)));
    else setFrom(monthStartLocalIso());
  }
  const activeQuick: 'today' | 'week' | 'month' | null = (() => {
    const now = new Date();
    if (to !== todayLocalIso()) return null;
    if (from === todayLocalIso()) return 'today';
    if (from === localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))) return 'week';
    if (from === monthStartLocalIso()) return 'month';
    return null;
  })();

  function clearFilters() {
    setStatusFilter('all');
    setProductFilter('all');
    setSearchInput('');
    setSearch('');
  }

  const iconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-[#77857c]';

  // Row actions are shared by the desktop table and the phone cards, so the
  // two layouts can never drift apart on which actions exist.
  function renderActions(s: Sale) {
    return (
      <div className="flex items-center justify-end gap-0.5">
        <button type="button" onClick={() => setViewSaleId(s.id)} className={clsx(iconBtn, 'hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30')} title="View receipt" aria-label={`View receipt ${s.invoice_number}`}>
          <Eye size={16} />
        </button>
        <button type="button" onClick={() => setViewSaleId(s.id)} className={clsx(iconBtn, 'hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30')} title="Print receipt" aria-label={`Print receipt ${s.invoice_number}`}>
          <Printer size={16} />
        </button>
        {s.status === 'COMPLETED' && s.payment_status === 'PARTIAL' ? (
          <button
            type="button"
            onClick={() => {
              setPaySale(s);
              setPayAmount(s.balance_due);
              setPayMethod('CASH');
            }}
            className={clsx(iconBtn, 'hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30')}
            title="Record payment"
            aria-label={`Record payment for ${s.invoice_number}`}
          >
            <HandCoins size={16} />
          </button>
        ) : (
          // Reserve the slot so the other icons line up row to row.
          <span className="hidden h-8 w-8 md:inline-block" aria-hidden="true" />
        )}
        {s.status === 'COMPLETED' && (
          <button type="button" onClick={() => setEditSaleId(s.id)} className={clsx(iconBtn, 'hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/30')} title="Edit sale" aria-label={`Edit sale ${s.invoice_number}`}>
            <Pencil size={16} />
          </button>
        )}
        {isOwner && s.status === 'COMPLETED' && (
          <button type="button" onClick={() => setVoidSale(s)} className={clsx(iconBtn, 'hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30')} title="Void sale" aria-label={`Void sale ${s.invoice_number}`}>
            <Ban size={16} />
          </button>
        )}
      </div>
    );
  }

  // Status + payment + balance + overdue + printed, stacked once.
  function renderStatus(s: Sale) {
    const overdue =
      s.status === 'COMPLETED' && s.payment_status === 'PARTIAL' && !!s.due_date && new Date(s.due_date) < new Date(new Date().toDateString());
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={s.status === 'VOIDED' ? 'red' : 'green'}>{s.status === 'VOIDED' ? 'Voided' : 'Completed'}</Badge>
          <PaymentMethodBadge sale={s} />
        </div>
        {s.status === 'COMPLETED' && s.payment_status === 'PARTIAL' && (
          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">Balance: {tzs(s.balance_due)}</span>
        )}
        {/* Overdue (2026-09-25, migration 021) — a due date was agreed for
            this sale's balance and it has passed. */}
        {overdue && <span className="text-[11px] font-bold text-danger-600 dark:text-danger-300">Overdue since {formatDate(s.due_date)}</span>}
        {s.status === 'COMPLETED' && <PrintedIndicator sale={s} />}
      </div>
    );
  }

  const rangeChip = (key: 'today' | 'week' | 'month', label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setQuickRange(key)}
      aria-pressed={activeQuick === key}
      className={clsx(
        'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400',
        activeQuick === key
          ? 'bg-green-600 text-white shadow-card'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#0e1512] dark:text-[#b6c2ba] dark:hover:bg-[#17211c]'
      )}
    >
      {label}
    </button>
  );

  return (
    <div>
      <PageHeader
        icon={<History size={20} />}
        title="Sales History"
        subtitle={
          isOwner
            ? 'Every completed and voided sale — nothing here is ever deleted.'
            : 'Sales you served — nothing here is ever deleted.'
        }
        action={
          <Link to="/pos">
            <Button icon={<ShoppingCart size={16} />}>New Sale</Button>
          </Link>
        }
      />

      <div className={`mb-5 grid grid-cols-2 gap-3 sm:gap-4 ${isOwner ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <div className="col-span-2 lg:col-span-1">
        <StatCard
          label="Total Sales"
          value={stats ? tzs(stats.totalSales) : '—'}
          icon={<Wallet size={18} />}
          tone="green"
          hint={stats && <TrendHint pct={stats.totalSalesChangePct} />}
        />
        </div>
        <StatCard
          label="Transactions"
          value={stats ? stats.transactionCount : '—'}
          icon={<Receipt size={18} />}
          tone="blue"
          hint={stats && <TrendHint pct={stats.transactionCountChangePct} />}
        />
        <StatCard
          label="Items Sold"
          value={stats ? stats.itemsSold : '—'}
          icon={<Package size={18} />}
          tone="purple"
          hint={stats && <TrendHint pct={stats.itemsSoldChangePct} />}
        />
        {isOwner && (
          <div className="col-span-2 lg:col-span-1">
          <StatCard
            label="Gross Profit"
            value={stats?.grossProfit !== undefined ? tzs(stats.grossProfit) : '—'}
            icon={<TrendingUp size={18} />}
            tone="amber"
            hint={stats?.grossProfitChangePct !== undefined && <TrendHint pct={stats.grossProfitChangePct} />}
          />
          </div>
        )}
      </div>

      {/* Filters (2026-10-09 UI pass) — one card: search + product + status on
          the first row, the date range on the second with one-tap chips for
          the ranges the shop actually uses. Same state, same API params as
          before; the date range still drives the stat cards above too. */}
      <Card className="mb-5 flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,1fr)_11rem_10rem]">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" aria-hidden="true" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search invoice, product or customer…"
              aria-label="Search sales"
              className="pl-9"
            />
          </div>
          <Select aria-label="Filter by product" value={String(productFilter)} onChange={(e) => setProductFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">All status</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOIDED">Voided</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-slate-100 pt-4 dark:border-[rgba(255,255,255,0.08)]">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick date ranges">
            <Calendar size={15} className="mr-1 text-slate-400 dark:text-[#77857c]" aria-hidden="true" />
            {rangeChip('today', 'Today')}
            {rangeChip('week', 'Last 7 days')}
            {rangeChip('month', 'This month')}
          </div>
          <div className="flex w-full items-end gap-2 sm:w-auto">
            <div className="min-w-0 flex-1 sm:flex-none">
              <label htmlFor="sh-from" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-[#97a49b]">From</label>
              <Input id="sh-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="sm:w-auto" />
            </div>
            <ArrowRight size={13} className="mb-3 text-slate-300 dark:text-[#4a5650]" aria-hidden="true" />
            <div className="min-w-0 flex-1 sm:flex-none">
              <label htmlFor="sh-to" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-[#97a49b]">To</label>
              <Input id="sh-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="sm:w-auto" />
            </div>
          </div>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="mb-2.5 rounded text-xs font-semibold text-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 dark:text-green-400 md:ml-auto">
              Clear filters
            </button>
          )}
        </div>
      </Card>

      <Card className={clsx('transition-opacity', loading && sales.length > 0 && 'opacity-60')} aria-busy={loading}>
        {loading && sales.length === 0 ? (
          <div className="flex flex-col gap-3 p-5" aria-label="Loading sales">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : sales.length === 0 ? (
          <EmptyState
            icon={<History size={30} />}
            title="No sales match those filters."
            description="Try a wider date range or clear the filters."
            action={
              filtersActive ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop / tablet: table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Customer</Th>
                    <Th>Items</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <tbody>
                  {pageItems.map((s) => (
                    <Tr key={s.id} className={s.status === 'VOIDED' ? 'opacity-70' : undefined}>
                      <Td>
                        <p className="font-mono text-xs font-semibold text-slate-800 dark:text-[#eef3ef]">{s.invoice_number}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">{formatDateTime(s.sale_date)}</p>
                      </Td>
                      <Td>
                        <p className="font-medium text-slate-800 dark:text-[#eef3ef]">{s.customer_name || 'Walk-in Customer'}</p>
                        {isOwner && <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">Served by {s.served_by_name}</p>}
                      </Td>
                      <Td>
                        <button type="button" onClick={() => setViewSaleId(s.id)} className="rounded text-left text-sm font-medium text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-blue-400">
                          {s.item_count ?? 0} item{s.item_count === 1 ? '' : 's'}
                        </button>
                      </Td>
                      <Td className="text-right font-display font-bold tabular-nums text-slate-800 dark:text-[#eef3ef]">{tzs(s.total)}</Td>
                      <Td>{renderStatus(s)}</Td>
                      <Td>{renderActions(s)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* Phone: one card per sale (a 6-column table doesn't fit) */}
            <ul className="divide-y divide-slate-100 dark:divide-[rgba(255,255,255,0.08)] md:hidden">
              {pageItems.map((s) => (
                <li key={s.id} className={clsx('flex flex-col gap-2.5 p-4', s.status === 'VOIDED' && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-slate-800 dark:text-[#eef3ef]">{s.invoice_number}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">{formatDateTime(s.sale_date)}</p>
                    </div>
                    <p className="font-display text-lg font-extrabold tabular-nums text-slate-800 dark:text-[#f4f8f5]">{tzs(s.total)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <p className="min-w-0 truncate font-medium text-slate-700 dark:text-[#d2dbd5]">
                      {s.customer_name || 'Walk-in Customer'}
                      {isOwner && <span className="font-normal text-slate-400 dark:text-[#77857c]"> · {s.served_by_name}</span>}
                    </p>
                    <button type="button" onClick={() => setViewSaleId(s.id)} className="shrink-0 rounded text-sm font-medium text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-blue-400">
                      {s.item_count ?? 0} item{s.item_count === 1 ? '' : 's'}
                    </button>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    {renderStatus(s)}
                    {renderActions(s)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {sales.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">
            <p className="text-[12.5px] text-slate-500 dark:text-[#97a49b]">
              Showing {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, sales.length)} of {sales.length} sales
            </p>
            <nav className="flex items-center gap-1" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pageSafe === 1}
                aria-label="Previous page"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:opacity-30 disabled:hover:bg-transparent dark:text-[#97a49b] dark:hover:bg-[#17211c]"
              >
                <ChevronLeft size={15} />
              </button>
              {pageWindow(pageSafe, totalPages).map((n, i) =>
                n === 'gap' ? (
                  <span key={`gap-${i}`} className="px-1 text-[12.5px] text-slate-300 dark:text-[#5a655e]">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    aria-label={`Page ${n}`}
                    aria-current={n === pageSafe ? 'page' : undefined}
                    className={`h-8 min-w-[2rem] rounded-md px-1 text-[12.5px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 ${
                      n === pageSafe ? 'bg-green-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-[#97a49b] dark:hover:bg-[#17211c]'
                    }`}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={pageSafe === totalPages}
                aria-label="Next page"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:opacity-30 disabled:hover:bg-transparent dark:text-[#97a49b] dark:hover:bg-[#17211c]"
              >
                <ChevronRight size={15} />
              </button>
            </nav>
          </div>
        )}
      </Card>

      <Modal
        open={viewSaleId !== null}
        onClose={() => setViewSaleId(null)}
        title="Receipt"
        size="lg"
        footer={
          <Button
            variant="outline"
            onClick={() => viewSaleId !== null && handlePrint(viewSaleId)}
            icon={<Printer size={15} />}
          >
            Print
          </Button>
        }
      >
        {viewSaleId !== null && <ReceiptView saleId={viewSaleId} />}
      </Modal>

      <EditSaleModal saleId={editSaleId} onClose={() => setEditSaleId(null)} onSaved={load} />

      {/* Record a follow-up payment against a PARTIAL sale's balance
          (2026-09-12, CLAUDE.md #50). */}
      <Modal
        open={paySale !== null}
        onClose={() => setPaySale(null)}
        title={`Record payment — ${paySale?.invoice_number ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPaySale(null)}>
              Cancel
            </Button>
            <Button loading={paying} onClick={confirmPayment}>
              Record Payment
            </Button>
          </>
        }
      >
        {paySale && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-[#b6c2ba]">
              Balance owed: <span className="font-semibold text-slate-800 dark:text-[#eef3ef]">{tzs(paySale.balance_due)}</span>
            </p>
            <div>
              <Label>Amount received</Label>
              <Input type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
              </Select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={voidSale !== null}
        onClose={() => setVoidSale(null)}
        title={`Void sale ${voidSale?.invoice_number ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setVoidSale(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={voiding} onClick={confirmVoid}>
              Void Sale
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-[#b6c2ba] mb-3">
          This reverses the sale's stock movements and marks it VOIDED. The original transaction record is kept
          permanently for audit purposes.
        </p>
        <Label>Reason (required)</Label>
        <Textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus />
      </Modal>
    </div>
  );
}
