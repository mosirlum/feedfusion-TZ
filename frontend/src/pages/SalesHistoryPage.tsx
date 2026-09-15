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
import { tzs, formatDateTime, pageWindow } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FullPageSpinner,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
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

// Local-calendar-date helpers (2026-09-11) — deliberately NOT the shared
// todayIso()/isoDaysAgo() in lib/format.ts, which round-trip through
// Date.toISOString() (UTC). That shifts the calendar date by a day for any
// browser whose local timezone is ahead of UTC — e.g. Tanzania is UTC+3, so
// any moment between local midnight and 03:00 reports YESTERDAY's date, and
// the same skew affects a month-start default built the same way (see
// ProductsPage.tsx's monthStartIso()). This looks like a latent, real bug in
// those shared helpers, not something introduced here — flagged in CLAUDE.md
// rather than changed, since todayIso() is load-bearing elsewhere (BR-33
// cash reconciliation, POS's date stamp) and fixing it is a bigger, separate
// change than this page's redesign. These two helpers stay local-date-only
// so this page's own default range isn't affected by the same issue.
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
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
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
    <span className={up ? 'text-green-600' : 'text-danger-600'}>
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

  if (loading && sales.length === 0) return <FullPageSpinner />;

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

      <div className={`mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 ${isOwner ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <StatCard
          label="Total Sales"
          value={stats ? tzs(stats.totalSales) : '—'}
          icon={<Wallet size={18} />}
          tone="green"
          hint={stats && <TrendHint pct={stats.totalSalesChangePct} />}
        />
        <StatCard
          label="Total Transactions"
          value={stats ? stats.transactionCount : '—'}
          icon={<Receipt size={18} />}
          tone="blue"
          hint={stats && <TrendHint pct={stats.transactionCountChangePct} />}
        />
        <StatCard
          label="Total Items Sold"
          value={stats ? stats.itemsSold : '—'}
          icon={<Package size={18} />}
          tone="purple"
          hint={stats && <TrendHint pct={stats.itemsSoldChangePct} />}
        />
        {isOwner && (
          <StatCard
            label="Total Profit (Gross)"
            value={stats?.grossProfit !== undefined ? tzs(stats.grossProfit) : '—'}
            icon={<TrendingUp size={18} />}
            tone="amber"
            hint={stats?.grossProfitChangePct !== undefined && <TrendHint pct={stats.grossProfitChangePct} />}
          />
        )}
      </div>

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-slate-400 dark:text-[#77857c]" />
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
          <ArrowRight size={13} className="text-slate-300" />
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-auto" />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by invoice number, product, or customer…"
              className="w-64 pl-9"
            />
          </div>
          <Select value={String(productFilter)} onChange={(e) => setProductFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="w-40">
            <option value="all">All Products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-36">
            <option value="all">All Status</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOIDED">Voided</option>
          </Select>
        </div>
      </Card>

      <Card>
        {sales.length === 0 ? (
          <EmptyState title="No sales match those filters." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>#</Th>
                <Th>Invoice No.</Th>
                <Th>Date &amp; Time</Th>
                <Th>Customer</Th>
                {isOwner && <Th>Served By</Th>}
                <Th>Products</Th>
                <Th className="text-right">Total Amount</Th>
                <Th>Payment</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </THead>
            <tbody>
              {pageItems.map((s, i) => (
                <Tr key={s.id}>
                  <Td className="text-slate-400 dark:text-[#77857c]">{(pageSafe - 1) * PAGE_SIZE + i + 1}</Td>
                  <Td className="font-mono text-xs font-medium text-slate-700 dark:text-[#d2dbd5]">{s.invoice_number}</Td>
                  <Td className="text-xs text-slate-500 dark:text-[#97a49b]">{formatDateTime(s.sale_date)}</Td>
                  <Td>{s.customer_name || 'Walk-in Customer'}</Td>
                  {isOwner && <Td className="text-slate-500 dark:text-[#97a49b]">{s.served_by_name}</Td>}
                  <Td>
                    <p className="text-slate-700 dark:text-[#d2dbd5]">
                      {s.item_count ?? 0} item{s.item_count === 1 ? '' : 's'}
                    </p>
                    <button onClick={() => setViewSaleId(s.id)} className="text-xs font-medium text-blue-600 hover:underline">
                      View items
                    </button>
                  </Td>
                  <Td className="text-right font-semibold">{tzs(s.total)}</Td>
                  <Td>
                    {/* Real, not decorative (2026-09-12, CLAUDE.md #50):
                        payments can now be CASH, BANK_TRANSFER, or
                        MOBILE_MONEY, and a sale can carry more than one
                        (a deposit plus later top-ups) — this shows the
                        method of the most recent payment, with a "+N" hint
                        when more than one method was actually used. */}
                    <PaymentMethodBadge sale={s} />
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <Badge tone={s.status === 'VOIDED' ? 'red' : 'green'}>{s.status}</Badge>
                      {s.status === 'COMPLETED' && s.payment_status === 'PARTIAL' && (
                        <span className="text-[10.5px] font-medium text-amber-600">Balance: {tzs(s.balance_due)}</span>
                      )}
                      {s.status === 'COMPLETED' && <PrintedIndicator sale={s} />}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setViewSaleId(s.id)} className="text-slate-400 dark:text-[#77857c] hover:text-blue-600" title="View receipt">
                        <Eye size={16} />
                      </button>
                      <button onClick={() => setViewSaleId(s.id)} className="text-slate-400 dark:text-[#77857c] hover:text-blue-600" title="Print receipt">
                        <Printer size={16} />
                      </button>
                      {s.status === 'COMPLETED' && s.payment_status === 'PARTIAL' && (
                        <button
                          onClick={() => {
                            setPaySale(s);
                            setPayAmount(s.balance_due);
                            setPayMethod('CASH');
                          }}
                          className="text-slate-400 dark:text-[#77857c] hover:text-green-600"
                          title="Record payment"
                        >
                          <HandCoins size={16} />
                        </button>
                      )}
                      {s.status === 'COMPLETED' && (
                        <button onClick={() => setEditSaleId(s.id)} className="text-slate-400 dark:text-[#77857c] hover:text-amber-600" title="Edit sale">
                          <Pencil size={16} />
                        </button>
                      )}
                      {isOwner && s.status === 'COMPLETED' && (
                        <button onClick={() => setVoidSale(s)} className="text-slate-400 dark:text-[#77857c] hover:text-danger-600" title="Void sale">
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {sales.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-4">
            <p className="text-[12.5px] text-slate-400 dark:text-[#77857c]">
              Showing {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, sales.length)} of {sales.length} sales
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-slate-400 dark:text-[#77857c]">
                Page {pageSafe} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe === 1}
                  className="rounded-md px-2 py-1 text-slate-400 dark:text-[#77857c] hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
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
                      onClick={() => setPage(n)}
                      className={`h-7 w-7 rounded-md text-[12.5px] font-semibold ${
                        n === pageSafe ? 'bg-green-600 text-white' : 'text-slate-500 dark:text-[#97a49b] hover:bg-slate-100'
                      }`}
                    >
                      {n}
                    </button>
                  )
                )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe === totalPages}
                  className="rounded-md px-2 py-1 text-slate-400 dark:text-[#77857c] hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
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
