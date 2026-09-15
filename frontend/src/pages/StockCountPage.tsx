import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Check, X, ClipboardList, Clock, CheckCircle2, XCircle, Gauge, Search, Lock } from 'lucide-react';
import { stockCountsApi, productsApi, apiErrorMessage } from '../lib/api';
import { StockCount, Product, StockLevel, StockCountSummary, StockCountActivityEvent } from '../types';
import { formatDate, timeAgo, initials, roleLabel } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FullPageSpinner,
  IconChip,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';

const REASONS = ['Damaged', 'Missing', 'Counting correction', 'Other'];
type QueueStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

/**
 * Stock Count Center, redesigned from the owner's own reference mockup
 * (2026-09-12, CLAUDE.md #37) — replaces the old form-plus-table layout
 * with a live variance preview, stat cards, a card-based Approval Queue,
 * and a Recent Activity sidebar, matching the visual language already
 * established for the Change Approval Center (CLAUDE.md #36).
 *
 * Two schema gaps the mockup surfaced, both closed with additive migration
 * 013 rather than dropped: a free-text "Notes / Explanation" field
 * alongside the existing categorical "Reason" pill (stock_counts only ever
 * had `reason`), and a `reviewed_at` timestamp (every OTHER approval table
 * in this app already had one — stock_counts never did, so there was no
 * honest way to show "approved 2h ago" separately from "submitted 2h ago").
 *
 * One thing the mockup shows that's deliberately NOT changed: every
 * submission — including the owner's own — still becomes a PENDING
 * proposal that needs a separate approval step. Every other approval flow
 * in this app (Price Proposals, Sale/Purchase Corrections) auto-approves
 * the owner's own submission; Stock Count never did, and the mockup's own
 * caption ("Submitting creates a pending proposal only," no role carve-out
 * shown anywhere) confirms that's intentional here, not an oversight.
 *
 * No product photos or SKU codes, same reasoning as every other redesign
 * this app has had — colored initials stand in for a photo, and a
 * product's real category name is the identifying subtitle instead of a
 * fabricated SKU.
 */
export default function StockCountPage() {
  const { isOwner } = useAuth();
  const toast = useToast();

  // --- Record Physical Count form ---
  const [products, setProducts] = useState<Product[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [productId, setProductId] = useState<number | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [showProductList, setShowProductList] = useState(false);
  const [physicalQty, setPhysicalQty] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    productsApi.list(isOwner).then((res) => setProducts(res.data));
    productsApi.stockLevels().then((res) => setStockLevels(res.data));
  }, [isOwner]);

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const expectedQty = productId != null ? stockLevels.find((s) => s.product_id === productId)?.current_stock ?? 0 : null;
  const variancePreview =
    expectedQty != null && physicalQty !== '' && Number.isFinite(Number(physicalQty))
      ? Number(physicalQty) - expectedQty
      : null;

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, productQuery]);

  function selectProduct(p: Product) {
    setProductId(p.id);
    setProductQuery(p.name);
    setShowProductList(false);
  }

  function resetForm() {
    setProductId(null);
    setProductQuery('');
    setPhysicalQty('');
    setReason(REASONS[0]);
    setNotes('');
  }

  // --- Approval Queue + stat cards + Recent Activity (owner-only) ---
  const [statusFilter, setStatusFilter] = useState<QueueStatus>('PENDING');
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(isOwner);
  const [actingId, setActingId] = useState<number | null>(null);
  const [summary, setSummary] = useState<StockCountSummary | null>(null);
  const [recentActivity, setRecentActivity] = useState<StockCountActivityEvent[]>([]);

  function loadCounts() {
    if (!isOwner) return;
    setLoadingCounts(true);
    stockCountsApi
      .list()
      .then((res) => setCounts(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load stock counts.')))
      .finally(() => setLoadingCounts(false));
  }

  function loadSidebar() {
    if (!isOwner) return;
    stockCountsApi
      .summary()
      .then((res) => setSummary(res.data))
      .catch(() => undefined);
    stockCountsApi
      .recentActivity(8)
      .then((res) => setRecentActivity(res.data))
      .catch(() => undefined);
  }

  useEffect(() => {
    loadCounts();
    loadSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!productId) {
      toast.error('Choose a product.');
      return;
    }
    if (physicalQty === '') {
      toast.error('Enter the physical quantity counted.');
      return;
    }
    setSubmitting(true);
    try {
      await stockCountsApi.record({
        productId,
        physicalQty: Number(physicalQty),
        reason,
        notes: notes.trim() || undefined,
      });
      toast.success('Count submitted — it will show the difference once the owner reviews it.');
      resetForm();
      loadCounts();
      loadSidebar();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not record this stock count.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function review(id: number, action: 'approve' | 'reject') {
    setActingId(id);
    try {
      await (action === 'approve' ? stockCountsApi.approve(id) : stockCountsApi.reject(id));
      toast.success(action === 'approve' ? 'Approved — stock corrected.' : 'Rejected.');
      loadCounts();
      loadSidebar();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not review this count.'));
    } finally {
      setActingId(null);
    }
  }

  const visibleCounts = useMemo(
    () => (statusFilter === 'ALL' ? counts : counts.filter((c) => c.status === statusFilter)),
    [counts, statusFilter]
  );

  const pending = summary?.pending ?? counts.filter((c) => c.status === 'PENDING').length;
  const pendingVariance = summary?.pendingVarianceUnits ?? 0;
  const countedToday = summary?.countedToday ?? 0;
  const countedYesterday = summary?.countedYesterday ?? 0;
  const rejectedToday = summary?.rejectedToday ?? 0;
  const countedHint =
    countedToday === 0 && countedYesterday === 0
      ? 'No counts yet today'
      : countedYesterday === 0
      ? 'First counts today'
      : (() => {
          const pct = Math.round(((countedToday - countedYesterday) / countedYesterday) * 100);
          return `${pct > 0 ? '+' : ''}${pct}% vs yesterday`;
        })();

  return (
    <div>
      <PageHeader
        icon={<ClipboardList size={20} />}
        title="Stock Count Center"
        subtitle="Reconcile physical stock against the system ledger through a propose → approve workflow."
      />

      {isOwner && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Pending Approval</p>
              <div className="rounded-lg bg-amber-50 p-2 text-amber-600"><Clock size={18} /></div>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{pending}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{pending > 0 ? 'Requires your attention' : 'All caught up'}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Counted Today</p>
              <div className="rounded-lg bg-green-50 p-2 text-green-700"><CheckCircle2 size={18} /></div>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{countedToday}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{countedHint}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Total Variance</p>
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><Gauge size={18} /></div>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{pendingVariance} units</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">Across pending counts</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Rejected Today</p>
              <div className="rounded-lg bg-danger-50 p-2 text-danger-600"><XCircle size={18} /></div>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{rejectedToday}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{rejectedToday > 0 ? 'Needs review' : 'No rejections today'}</p>
          </Card>
        </div>
      )}

      <div className={isOwner ? 'grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)_300px]' : 'max-w-md'}>
        <Card className="h-fit p-5">
          <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-800 dark:text-[#eef3ef]">
            <IconChip tone="green" size={28} icon={<ClipboardList size={14} />} />
            Record Physical Count
          </h3>
          <p className="mb-4 text-xs text-slate-400 dark:text-[#77857c]">Enter the actual quantity counted in the field.</p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="relative">
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Product</label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
                <Input
                  value={productQuery}
                  onChange={(e) => {
                    setProductQuery(e.target.value);
                    setProductId(null);
                    setShowProductList(true);
                  }}
                  onFocus={() => setShowProductList(true)}
                  onBlur={() => setTimeout(() => setShowProductList(false), 150)}
                  placeholder="Search and select product..."
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              {showProductList && filteredProducts.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] shadow-panel">
                  {filteredProducts.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onMouseDown={() => selectProduct(p)}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-green-50"
                    >
                      <span className="text-slate-700 dark:text-[#d2dbd5]">{p.name}</span>
                      <span className="text-xs text-slate-400 dark:text-[#77857c]">{p.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Physical Quantity Counted</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={physicalQty}
                  onChange={(e) => setPhysicalQty(e.target.value)}
                  required
                />
                <span className="flex-shrink-0 text-sm text-slate-400 dark:text-[#77857c]">{selectedProduct?.unit ?? 'units'}</span>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Expected Stock (from system ledger)</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500 dark:text-[#97a49b]">
                <Lock size={13} className="flex-shrink-0" />
                {productId != null ? `${expectedQty} ${selectedProduct?.unit ?? 'units'}` : 'Select a product first'}
              </div>
              <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">Calculated automatically — not editable.</p>
            </div>

            {variancePreview !== null && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Live Variance Preview</label>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
                    variancePreview === 0
                      ? 'bg-slate-100 dark:bg-[#0e1512] text-slate-600 dark:text-[#b6c2ba]'
                      : variancePreview > 0
                      ? 'bg-green-100 text-green-700'
                      : 'bg-danger-50 text-danger-600'
                  }`}
                >
                  {variancePreview > 0 ? '+' : ''}
                  {variancePreview} units
                </span>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Reason for count difference</label>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setReason(r)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      reason === r ? 'border-green-600 bg-green-50 text-green-700' : 'border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-50'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Notes / Explanation</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                placeholder="Add a note or explanation for this count..."
              />
              <p className="mt-1 text-right text-xs text-slate-400 dark:text-[#77857c]">{notes.length}/500</p>
            </div>

            <Button type="submit" className="w-full" loading={submitting}>
              Submit Count Proposal
            </Button>
            <p className="text-center text-xs text-slate-400 dark:text-[#77857c]">
              Submitting creates a pending proposal — the owner reviews it before stock changes.
            </p>
          </form>
        </Card>

        {isOwner && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-[#eef3ef]">Approval Queue</h3>
                <p className="text-xs text-slate-400 dark:text-[#77857c]">Review and approve or reject stock count proposals.</p>
              </div>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QueueStatus)} className="w-36">
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="ALL">All Statuses</option>
              </Select>
            </div>

            {loadingCounts ? (
              <Card>
                <FullPageSpinner />
              </Card>
            ) : visibleCounts.length === 0 ? (
              <Card>
                <EmptyState title="Nothing here." description="No stock counts match this filter." />
              </Card>
            ) : (
              <div className="space-y-4">
                {visibleCounts.map((c) => (
                  <Card key={c.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-xs font-bold text-white">
                          {initials(c.counted_by_name ?? '?')}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">{c.counted_by_name}</p>
                          <p className="text-xs text-slate-400 dark:text-[#77857c]">{c.counted_by_role ? roleLabel(c.counted_by_role) : ''}</p>
                        </div>
                        {c.status !== 'PENDING' && (
                          <Badge tone={c.status === 'APPROVED' ? 'green' : 'red'}>{c.status}</Badge>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 dark:text-[#77857c]">{timeAgo(c.created_at)}</span>
                    </div>

                    <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">
                      {c.product_name}
                      {c.category_name && <span className="font-normal text-slate-400 dark:text-[#77857c]"> — {c.category_name}</span>}
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Expected</p>
                        <p className="text-sm font-semibold text-slate-500 dark:text-[#97a49b]">
                          {c.expected_qty} {c.unit}
                        </p>
                      </div>
                      <div
                        className={`rounded-lg px-3 py-2.5 ${
                          c.difference === 0 ? 'bg-slate-50' : c.difference > 0 ? 'bg-green-50' : 'bg-danger-50'
                        }`}
                      >
                        <p
                          className={`text-[11px] uppercase tracking-wide ${
                            c.difference === 0 ? 'text-slate-400 dark:text-[#77857c]' : c.difference > 0 ? 'text-green-700' : 'text-danger-600'
                          }`}
                        >
                          Physical ({c.difference > 0 ? '+' : ''}
                          {c.difference})
                        </p>
                        <p
                          className={`text-sm font-semibold ${
                            c.difference === 0 ? 'text-slate-600 dark:text-[#b6c2ba]' : c.difference > 0 ? 'text-green-700' : 'text-danger-600'
                          }`}
                        >
                          {c.physical_qty} {c.unit}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-[13px] text-slate-600 dark:text-[#b6c2ba]">
                      <span className="font-semibold">Reason: </span>
                      {c.reason}
                    </p>
                    {c.notes && (
                      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                        <span className="font-semibold">Note: </span>
                        {c.notes}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] pt-3">
                      <p className="text-xs text-slate-400 dark:text-[#77857c]">
                        {c.status === 'PENDING'
                          ? `Submitted on ${formatDate(c.created_at)}`
                          : `${c.status === 'APPROVED' ? 'Approved' : 'Rejected'} by ${c.approved_by_name ?? 'the owner'} on ${formatDate(c.reviewed_at)}`}
                      </p>
                      {c.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" loading={actingId === c.id} onClick={() => review(c.id, 'reject')} icon={<X size={14} />}>
                            Reject
                          </Button>
                          <Button type="button" size="sm" loading={actingId === c.id} onClick={() => review(c.id, 'approve')} icon={<Check size={14} />}>
                            Approve
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {isOwner && (
          <div className="flex flex-col gap-4">
            <Card className="p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-800 dark:text-[#eef3ef]">
                <IconChip tone="slate" size={28} icon={<Clock size={14} />} />
                Recent Activity
              </h3>
              {recentActivity.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400 dark:text-[#77857c]">Nothing recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {recentActivity.map((a) => {
                    const Icon = a.action === 'RECORDED' ? ClipboardList : a.action === 'APPROVED' ? CheckCircle2 : XCircle;
                    const color = a.action === 'RECORDED' ? 'text-blue-600' : a.action === 'APPROVED' ? 'text-green-600' : 'text-danger-500';
                    return (
                      <li key={a.id} className="flex items-start gap-2.5">
                        <Icon size={16} className={`mt-0.5 flex-shrink-0 ${color}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-700 dark:text-[#d2dbd5]">
                            {a.action === 'RECORDED' ? 'Count submitted' : a.action === 'APPROVED' ? 'Count approved' : 'Count rejected'}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-[#97a49b]">
                            {a.productName} · {a.quantity} units
                          </p>
                          <p className="text-xs text-slate-400 dark:text-[#77857c]">
                            {timeAgo(a.at)} · by {a.actorName}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="bg-green-50/60 p-5">
              <p className="text-sm font-semibold text-green-800">Quick tip</p>
              <p className="mt-1 text-xs text-green-700">
                Use the status filter to find specific requests, or start with Pending — that's what's waiting on you.
              </p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
