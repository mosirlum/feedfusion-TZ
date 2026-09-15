import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, Plus, Minus, TrendingUp, TrendingDown, PackageMinus, CalendarClock, Lock } from 'lucide-react';
import { stockAdjustmentsApi, productsApi, apiErrorMessage } from '../lib/api';
import { StockAdjustment, Product, StockLevel, StockAdjustmentsSummary } from '../types';
import { timeAgo, initials, roleLabel } from '../lib/format';
import { Button, Card, EmptyState, FullPageSpinner, IconChip, Input, PageHeader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/ui/Toast';

// Split by direction (2026-09-13, CLAUDE.md #65) — the owner raised a real
// business-logic concern: stock should go up via Purchases (which capture
// cost/supplier — real traceability) and down via Sales; an Adjustment is
// only for the exceptions neither of those covers. Damaged/Expired/Lost
// only ever make sense as a decrease (a loss event never adds units), and
// Found/Correction are the only legitimate reasons an Adjustment (as
// opposed to a Purchase) should increase stock — a physical count turning
// up more than expected, or fixing an earlier data-entry mistake.
// "Other"/"Correction" stay on both sides since a correction can run
// either direction. Mirrors `INCREASE_REASONS`/`DECREASE_REASONS` in
// `backend/src/services/stockAdjustments.service.ts`, which enforces this
// server-side too — this filtering is a UX guardrail, not the only guard.
const INCREASE_REASONS = ['Found', 'Correction', 'Other'];
const DECREASE_REASONS = ['Damaged', 'Expired', 'Lost', 'Correction', 'Other'];
type RangeFilter = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL';

/**
 * Stock Adjustments Center, redesigned from the owner's own reference
 * mockup (2026-09-12, CLAUDE.md #38) — matches the visual language already
 * established for the Change Approval Center (#36) and Stock Count Center
 * (#37): stat cards, a live preview panel, reason pills, and a card-based
 * history in place of the old plain table.
 *
 * This feature has no approval workflow at all (Section 23: owner-only,
 * applies immediately — there's no `status` column on stock_adjustments),
 * so unlike the other two redesigns there's no queue and no PENDING concept.
 * The stat row and history filter are built around time windows instead.
 *
 * Two judgment calls, both flagged in CLAUDE.md #38 rather than silently
 * decided:
 *  - `reason` tightens from unconstrained free text to these 6 fixed pills,
 *    on the strong precedent of the near-identical Stock Count feature and
 *    the mockup itself. This is a real behavior change (previously any
 *    non-empty string was accepted), now enforced server-side too.
 *  - "Total Units Written Off" is a genuine interpretation, not a restated
 *    total: it sums only DECREASE adjustments reasoned Damaged/Expired/Lost
 *    over the trailing 7 days (vs. the prior 7 days for the trend) —
 *    deliberately excluding Correction (a bookkeeping fix, not a loss) and
 *    Found (a positive adjustment), so it doesn't just duplicate "Stock
 *    Decreased."
 *
 * No product photos or SKU codes (precedent from every other redesign this
 * app has had) — colored initials stand in for a photo, and the product's
 * real category name is the identifying subtitle. The mockup's own copy
 * says adjustments post "as STOCK_ADJUSTMENT entries" — this page uses the
 * real values instead (`movement_type: 'ADJUSTMENT'`, `reference_type:
 * 'stock_adjustment'`) rather than repeating that inaccuracy.
 */
export default function StockAdjustmentsPage() {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  // --- Record Adjustment form ---
  const [products, setProducts] = useState<Product[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  // Preselects when arriving from the Inventory page's row "…" action
  // (/stock-adjustments?product=<id>) — so the owner doesn't have to
  // re-find the product in this page's own dropdown.
  const [productId, setProductId] = useState(searchParams.get('product') ?? '');
  const [direction, setDirection] = useState<'increase' | 'decrease'>('decrease');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState(DECREASE_REASONS[0]);
  const [notes, setNotes] = useState('');
  const availableReasons = direction === 'increase' ? INCREASE_REASONS : DECREASE_REASONS;

  // Switching direction can leave a stale reason selected that no longer
  // applies (e.g. "Damaged" while switched to Increase) — falls back to the
  // new direction's first option, but keeps the current one if it's still
  // valid on both sides (Correction/Other).
  function selectDirection(next: 'increase' | 'decrease') {
    setDirection(next);
    const list = next === 'increase' ? INCREASE_REASONS : DECREASE_REASONS;
    setReason((current) => (list.includes(current) ? current : list[0]));
  }
  const [submitting, setSubmitting] = useState(false);

  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<StockAdjustmentsSummary | null>(null);
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('TODAY');

  useEffect(() => {
    productsApi.list(true).then((res) => {
      setProducts(res.data);
      // If the id in the URL doesn't match a real product (deleted, or a
      // stale/typo'd link), don't leave a dangling selection behind.
      setProductId((current) => (current && !res.data.some((p) => String(p.id) === current) ? '' : current));
    });
    productsApi.stockLevels().then((res) => setStockLevels(res.data));
    load();
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    setLoading(true);
    stockAdjustmentsApi
      .list()
      .then((res) => setAdjustments(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load stock adjustments.')))
      .finally(() => setLoading(false));
  }

  function loadSummary() {
    stockAdjustmentsApi
      .summary()
      .then((res) => setSummary(res.data))
      .catch(() => undefined);
  }

  const selectedProduct = products.find((p) => String(p.id) === productId) ?? null;
  const currentStock =
    selectedProduct != null ? stockLevels.find((s) => s.product_id === selectedProduct.id)?.current_stock ?? 0 : null;
  const magnitude = Math.abs(Number(quantity)) || 0;
  const resultingStock =
    currentStock != null && magnitude > 0 ? currentStock + (direction === 'decrease' ? -magnitude : magnitude) : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!productId) {
      toast.error('Choose a product.');
      return;
    }
    if (!magnitude) {
      toast.error('Enter a non-zero quantity.');
      return;
    }
    setSubmitting(true);
    try {
      await stockAdjustmentsApi.create({
        productId: Number(productId),
        quantity: direction === 'decrease' ? -magnitude : magnitude,
        reason,
        notes: notes.trim() || undefined,
      });
      toast.success('Stock adjustment recorded.');
      setProductId('');
      setQuantity('');
      setReason(direction === 'increase' ? INCREASE_REASONS[0] : DECREASE_REASONS[0]);
      setNotes('');
      load();
      loadSummary();
      productsApi.stockLevels().then((res) => setStockLevels(res.data));
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not record this adjustment.'));
    } finally {
      setSubmitting(false);
    }
  }

  const visibleAdjustments = useMemo(() => {
    if (rangeFilter === 'ALL') return adjustments;
    const now = new Date();
    const cutoff = new Date(now);
    if (rangeFilter === 'TODAY') cutoff.setHours(0, 0, 0, 0);
    else if (rangeFilter === 'WEEK') cutoff.setDate(cutoff.getDate() - 7);
    else cutoff.setDate(cutoff.getDate() - 30);
    return adjustments.filter((a) => new Date(a.created_at) >= cutoff);
  }, [adjustments, rangeFilter]);

  const adjustmentsToday = summary?.adjustmentsToday ?? 0;
  const adjustmentsYesterday = summary?.adjustmentsYesterday ?? 0;
  const todayHint =
    adjustmentsToday === 0 && adjustmentsYesterday === 0
      ? 'No adjustments yet today'
      : adjustmentsYesterday === 0
      ? 'First adjustments today'
      : (() => {
          const pct = Math.round(((adjustmentsToday - adjustmentsYesterday) / adjustmentsYesterday) * 100);
          return `${pct > 0 ? '+' : ''}${pct}% vs yesterday`;
        })();

  return (
    <div>
      <PageHeader
        icon={<SlidersHorizontal size={20} />}
        title="Stock Adjustments Center"
        subtitle="Direct manual corrections to the stock ledger — damage, loss, or counting fixes. Owner-approved by definition (Section 23)."
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Adjustments Today</p>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
              <CalendarClock size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{adjustmentsToday}</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{todayHint}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Units Written Off</p>
            <div className="rounded-lg bg-danger-50 p-2 text-danger-600">
              <PackageMinus size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{summary?.writtenOffLast7 ?? 0} units</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{summary?.writtenOffHint ?? 'Last 7 days'}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Stock Increased</p>
            <div className="rounded-lg bg-green-50 p-2 text-green-700">
              <TrendingUp size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{summary?.increasedLast7 ?? 0} units</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">Last 7 days</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Stock Decreased</p>
            <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
              <TrendingDown size={18} />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{summary?.decreasedLast7 ?? 0} units</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">Last 7 days</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="h-fit p-5">
          <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-800 dark:text-[#eef3ef]">
            <IconChip tone="amber" size={28} icon={<SlidersHorizontal size={14} />} />
            New Adjustment
          </h3>
          <p className="mb-4 text-xs text-slate-400 dark:text-[#77857c]">Applies immediately — there is no separate approval step.</p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Product</label>
              <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Direction</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => selectDirection('decrease')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    direction === 'decrease'
                      ? 'border-danger-500 bg-danger-50 text-danger-600'
                      : 'border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-50'
                  }`}
                >
                  <Minus size={14} /> Decrease
                </button>
                <button
                  type="button"
                  onClick={() => selectDirection('increase')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    direction === 'increase'
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-50'
                  }`}
                >
                  <Plus size={14} /> Increase
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Quantity</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity(String(Math.max(0, magnitude - 1)))}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-50"
                  aria-label="Decrease quantity"
                >
                  <Minus size={14} />
                </button>
                <Input
                  type="number"
                  min={0}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="text-center"
                  required
                />
                <button
                  type="button"
                  onClick={() => setQuantity(String(magnitude + 1))}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-50"
                  aria-label="Increase quantity"
                >
                  <Plus size={14} />
                </button>
                <span className="flex-shrink-0 text-sm text-slate-400 dark:text-[#77857c]">{selectedProduct?.unit ?? 'units'}</span>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Current Stock</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500 dark:text-[#97a49b]">
                <Lock size={13} className="flex-shrink-0" />
                {productId ? `${currentStock} ${selectedProduct?.unit ?? 'units'}` : 'Select a product first'}
              </div>
            </div>

            {resultingStock !== null && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Resulting Stock (preview)</label>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
                    resultingStock < 0
                      ? 'bg-danger-50 text-danger-600'
                      : direction === 'decrease'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {resultingStock} {selectedProduct?.unit ?? 'units'}
                  {resultingStock < 0 && ' — cannot go negative'}
                </span>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Reason</label>
              <p className="mb-1.5 text-xs text-slate-400 dark:text-[#77857c]">
                {direction === 'increase'
                  ? "Adjustments should rarely add stock — use Purchases for normal restocking. Only for a count turning up more than expected, or fixing an earlier mistake."
                  : 'For damage, expiry, loss, or a correction — not a sale (that happens automatically).'}
              </p>
              <div className="flex flex-wrap gap-2">
                {availableReasons.map((r) => (
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
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Notes (optional)</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                placeholder="Add any extra detail..."
              />
              <p className="mt-1 text-right text-xs text-slate-400 dark:text-[#77857c]">{notes.length}/500</p>
            </div>

            <Button type="submit" className="w-full" loading={submitting}>
              Record Adjustment
            </Button>
            <p className="text-center text-xs text-slate-400 dark:text-[#77857c]">
              Posts immediately to the stock ledger as an ADJUSTMENT movement — no review step.
            </p>
          </form>
        </Card>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-[#eef3ef]">Adjustment History</h3>
              <p className="text-xs text-slate-400 dark:text-[#77857c]">Every manual correction, most recent first.</p>
            </div>
            <div className="flex gap-1.5">
              {(
                [
                  ['TODAY', 'Today'],
                  ['WEEK', 'This Week'],
                  ['MONTH', 'This Month'],
                  ['ALL', 'All'],
                ] as [RangeFilter, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRangeFilter(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    rangeFilter === value
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <Card>
              <FullPageSpinner />
            </Card>
          ) : visibleAdjustments.length === 0 ? (
            <Card>
              <EmptyState title="Nothing here." description="No stock adjustments in this time range." />
            </Card>
          ) : (
            <div className="space-y-4">
              {visibleAdjustments.map((a) => (
                <Card key={a.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-xs font-bold text-white">
                        {initials(a.created_by_name ?? '?')}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">{a.created_by_name}</p>
                        <p className="text-xs text-slate-400 dark:text-[#77857c]">{a.created_by_role ? roleLabel(a.created_by_role) : ''}</p>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 dark:text-[#77857c]">{timeAgo(a.created_at)}</span>
                  </div>

                  <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">
                    {a.product_name}
                    {a.category_name && <span className="font-normal text-slate-400 dark:text-[#77857c]"> — {a.category_name}</span>}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${
                        a.quantity >= 0 ? 'bg-green-100 text-green-700' : 'bg-danger-50 text-danger-600'
                      }`}
                    >
                      {a.quantity >= 0 ? <Plus size={13} /> : <Minus size={13} />}
                      {Math.abs(a.quantity)} {a.unit}
                    </span>
                    <span className="rounded-full bg-slate-100 dark:bg-[#0e1512] px-3 py-1 text-xs font-medium text-slate-600 dark:text-[#b6c2ba]">{a.reason}</span>
                  </div>

                  {a.notes && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                      <span className="font-semibold">Note: </span>
                      {a.notes}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Card className="mt-5 bg-green-50/60 p-5">
        <p className="text-sm font-semibold text-green-800">Quick tip</p>
        <p className="mt-1 text-xs text-green-700">
          Adjustments apply immediately and post to the stock ledger as an ADJUSTMENT movement — there's no undo, so
          double-check the product and quantity before recording. For discrepancies found during a physical count,
          use Stock Count instead so it goes through review first.
        </p>
      </Card>
    </div>
  );
}
