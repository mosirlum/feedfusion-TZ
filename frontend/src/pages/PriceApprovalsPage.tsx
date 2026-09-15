import { useEffect, useMemo, useState } from 'react';
import { Check, X, ShieldCheck, Clock, CheckCircle2, XCircle, Tag, Receipt, Truck, Search, Layers } from 'lucide-react';
import { priceProposalsApi, salesApi, purchasesApi, approvalsApi, apiErrorMessage } from '../lib/api';
import {
  PriceProposal,
  SaleEditRequest,
  PurchaseEditRequest,
  Sale,
  Purchase,
  ApprovalSummary,
  RecentActivityItem,
} from '../types';
import { tzs, formatDate, timeAgo, initials, roleLabel } from '../lib/format';
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
} from '../components/ui';
import { useToast } from '../components/ui/Toast';

type TypeFilter = 'all' | 'price' | 'sale' | 'purchase';
type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
type DateFilter = 'all' | 'today' | '7d' | '30d';

function describeSaleEditChanges(req: SaleEditRequest, cache: Record<number, Sale>): string[] {
  const sale = cache[req.sale_id];
  const lines: string[] = [];
  for (const patch of req.proposed_items) {
    const item = sale?.items?.find((i) => i.id === patch.saleItemId);
    const name = item?.product_name ?? `Item #${patch.saleItemId}`;
    const parts: string[] = [];
    if (!item || Number(item.quantity) !== patch.quantity) {
      parts.push(`qty ${item ? item.quantity : '?'} → ${patch.quantity}`);
    }
    if (!item || Number(item.unit_price) !== patch.unitPrice) {
      parts.push(`price ${item ? tzs(item.unit_price) : '?'} → ${tzs(patch.unitPrice)}`);
    }
    const oldDiscount = !item ? '?' : item.discount_type === 'NONE' ? 'none' : item.discount_type === 'FIXED' ? tzs(item.discount_value) : `${item.discount_value}%`;
    const newDiscount = patch.discountType === 'NONE' ? 'none' : patch.discountType === 'FIXED' ? tzs(patch.discountValue) : `${patch.discountValue}%`;
    if (!item || item.discount_type !== patch.discountType || Number(item.discount_value) !== patch.discountValue) {
      parts.push(`discount ${oldDiscount} → ${newDiscount}`);
    }
    if (parts.length > 0) lines.push(`${name}: ${parts.join(', ')}`);
  }
  return lines;
}

function describePurchaseEditChanges(req: PurchaseEditRequest, cache: Record<number, Purchase>): string[] {
  const purchase = cache[req.purchase_id];
  const lines: string[] = [];
  for (const patch of req.proposed_items) {
    const item = purchase?.items?.find((i) => i.id === patch.purchaseItemId);
    const name = item?.product_name ?? `Item #${patch.purchaseItemId}`;
    const parts: string[] = [];
    if (!item || Number(item.quantity) !== patch.quantity) parts.push(`qty ${item ? item.quantity : '?'} → ${patch.quantity}`);
    if (!item || Number(item.unit_cost) !== patch.unitCost) parts.push(`unit cost ${item ? tzs(item.unit_cost) : '?'} → ${tzs(patch.unitCost)}`);
    if (parts.length > 0) lines.push(`${name}: ${parts.join(', ')}`);
  }
  for (const patch of req.proposed_cost_lines) {
    const line = purchase?.additional_cost_lines?.find((l) => l.id === patch.costLineId);
    const label = line?.label ?? `Expense #${patch.costLineId}`;
    if (!line || Number(line.amount) !== patch.amount) {
      lines.push(`${label}: ${line ? tzs(line.amount) : '?'} → ${tzs(patch.amount)}`);
    }
  }
  return lines;
}

// A single normalized shape every approval type (price/sale/purchase) maps
// into, so the unified feed can render one card component instead of three
// near-duplicate ones. See CLAUDE.md #36 for the full redesign writeup.
interface ApprovalCard {
  key: string;
  type: 'price' | 'sale' | 'purchase';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requesterName: string;
  requesterRole: string;
  createdAt: string;
  reason: string | null;
  title: string;
  subtitle: string | null;
  oldLabel: string;
  oldValue: string;
  newLabel: string;
  newValue: string;
  detailLines: string[];
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  busy: boolean;
}

const TYPE_META: Record<ApprovalCard['type'], { label: string; badgeLabel: string; tone: 'blue' | 'green' | 'amber'; icon: typeof Tag }> = {
  price: { label: 'Products', badgeLabel: 'Price Change', tone: 'blue', icon: Tag },
  sale: { label: 'Sales', badgeLabel: 'Sale Change', tone: 'green', icon: Receipt },
  purchase: { label: 'Purchases', badgeLabel: 'Purchase Change', tone: 'amber', icon: Truck },
};

/**
 * Change Approval Center, redesigned a second time from the owner's own
 * reference mockup (2026-09-11, CLAUDE.md #36) — replaces the previous
 * three-separate-tabs layout with a single merged feed (price proposals +
 * sale corrections + purchase corrections), real stat cards, and a Recent
 * Activity sidebar. The mockup's "Priority" badges/filter were deliberately
 * left out — nothing in this schema tracks a priority for any of the three
 * request types, and the owner chose to drop it rather than have one
 * invented from an arbitrary threshold (confirmed via AskUserQuestion). The
 * mockup's per-item photo and SKU were dropped too, same reasoning already
 * established for Products/Suppliers/Inventory — a colored-initials tile
 * stands in for the requester's photo, and each card's identifying subtitle
 * is the real invoice/reference number or category, not a fabricated SKU.
 *
 * Also fixed here: `describeSaleEditChanges` was silently broken since the
 * original CLAUDE.md #35 build — it read `patch.sale_item_id` (snake_case),
 * but what's actually stored/returned is camelCase (`saleItemId`), so every
 * Sale Corrections diff rendered as an unmatched "?" on every field. Fixed
 * by correcting the field names and the `ProposedSaleItemPatch` type in
 * types/index.ts.
 */
export default function ApprovalCenterPage() {
  const toast = useToast();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [search, setSearch] = useState('');

  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);

  const [proposals, setProposals] = useState<PriceProposal[]>([]);
  const [saleRequests, setSaleRequests] = useState<SaleEditRequest[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseEditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [saleCache, setSaleCache] = useState<Record<number, Sale>>({});
  const [purchaseCache, setPurchaseCache] = useState<Record<number, Purchase>>({});

  const statusParam = statusFilter === 'ALL' ? undefined : statusFilter;

  function loadFeed() {
    setLoading(true);
    Promise.all([
      priceProposalsApi.list(statusParam),
      salesApi.listEditRequests(statusParam),
      purchasesApi.listEditRequests(statusParam),
    ])
      .then(([p, s, pu]) => {
        setProposals(p.data);
        setSaleRequests(s.data);
        setPurchaseRequests(pu.data);
      })
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load approval requests.')))
      .finally(() => setLoading(false));
  }

  function loadSidebar() {
    approvalsApi
      .summary()
      .then((res) => setSummary(res.data))
      .catch(() => {
        // Non-fatal — the feed and its own PENDING counts still work.
      });
    approvalsApi
      .recentActivity(8)
      .then((res) => setRecentActivity(res.data))
      .catch(() => {
        // Non-fatal — an empty sidebar list just shows its empty state.
      });
  }

  useEffect(() => {
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    loadSidebar();
  }, []);

  // Fetch (and cache) the full sale/purchase record behind every request
  // currently on screen, so the itemized diff can show real "current"
  // values rather than just the proposed new ones.
  useEffect(() => {
    const missing = Array.from(new Set(saleRequests.map((r) => r.sale_id))).filter((id) => !saleCache[id]);
    missing.forEach((id) => {
      salesApi
        .get(id)
        .then((res) => setSaleCache((prev) => ({ ...prev, [id]: res.data })))
        .catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleRequests]);

  useEffect(() => {
    const missing = Array.from(new Set(purchaseRequests.map((r) => r.purchase_id))).filter((id) => !purchaseCache[id]);
    missing.forEach((id) => {
      purchasesApi
        .get(id)
        .then((res) => setPurchaseCache((prev) => ({ ...prev, [id]: res.data })))
        .catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseRequests]);

  function refreshAfterAction() {
    loadFeed();
    loadSidebar();
  }

  async function actOnProposal(id: number, action: 'approve' | 'reject') {
    const key = `price-${id}`;
    setBusyKey(key);
    try {
      if (action === 'approve') {
        // Approving DOES flip the product's live price immediately — it
        // always has, on the backend. What was missing (2026-09-13,
        // CLAUDE.md #67) was ever telling the owner that: this used to just
        // say "Price approved." with no confirmation of the actual new
        // price, which read as "nothing happened" and led to manually
        // re-setting the price that had, in fact, already changed. Naming
        // the product and its new price here — same pattern the sale/
        // purchase correction approvals below already use.
        const res = await priceProposalsApi.approve(id);
        toast.success(`Price approved — ${res.data.product.name} is now ${tzs(res.data.product.active_price)}.`);
      } else {
        await priceProposalsApi.reject(id);
        toast.success('Proposal rejected — the price is unchanged.');
      }
      refreshAfterAction();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update this proposal.'));
    } finally {
      setBusyKey(null);
    }
  }

  async function actOnSaleRequest(id: number, action: 'approve' | 'reject') {
    const key = `sale-${id}`;
    setBusyKey(key);
    try {
      if (action === 'approve') {
        const res = await salesApi.approveEditRequest(id);
        toast.success(`Correction approved — sale ${res.data.sale.invoice_number} updated.`);
      } else {
        await salesApi.rejectEditRequest(id);
        toast.success('Correction rejected — the sale is unchanged.');
      }
      refreshAfterAction();
    } catch (err) {
      toast.error(apiErrorMessage(err, `Could not ${action} this correction.`));
    } finally {
      setBusyKey(null);
    }
  }

  async function actOnPurchaseRequest(id: number, action: 'approve' | 'reject') {
    const key = `purchase-${id}`;
    setBusyKey(key);
    try {
      if (action === 'approve') {
        const res = await purchasesApi.approveEditRequest(id);
        toast.success(`Correction approved — purchase ${res.data.purchase.reference_number} updated.`);
      } else {
        await purchasesApi.rejectEditRequest(id);
        toast.success('Correction rejected — the purchase is unchanged.');
      }
      refreshAfterAction();
    } catch (err) {
      toast.error(apiErrorMessage(err, `Could not ${action} this correction.`));
    } finally {
      setBusyKey(null);
    }
  }

  const cards: ApprovalCard[] = useMemo(() => {
    const priceCards: ApprovalCard[] = proposals.map((p) => {
      const key = `price-${p.id}`;
      return {
        key,
        type: 'price',
        status: p.status,
        requesterName: p.proposed_by_name ?? 'A staff member',
        requesterRole: p.proposed_by_role ? roleLabel(p.proposed_by_role) : '',
        createdAt: p.created_at,
        reason: p.notes,
        title: p.product_name ?? `Product #${p.product_id}`,
        subtitle: p.category_name ?? null,
        oldLabel: 'Current Price',
        oldValue: tzs(p.current_active_price),
        newLabel: 'Proposed Price',
        newValue: tzs(p.proposed_price),
        detailLines: [],
        reviewedByName: p.reviewed_by_name,
        reviewedAt: p.reviewed_at,
        busy: busyKey === key,
        ...(p.status === 'PENDING'
          ? { onApprove: () => actOnProposal(p.id, 'approve'), onReject: () => actOnProposal(p.id, 'reject') }
          : {}),
      };
    });

    const saleCards: ApprovalCard[] = saleRequests.map((r) => {
      const key = `sale-${r.id}`;
      return {
        key,
        type: 'sale',
        status: r.status,
        requesterName: r.requested_by_name ?? 'A staff member',
        requesterRole: r.requested_by_role ? roleLabel(r.requested_by_role) : '',
        createdAt: r.created_at,
        reason: r.reason,
        title: r.invoice_number ?? `Sale #${r.sale_id}`,
        subtitle: r.customer_name ?? null,
        oldLabel: 'Old Total',
        oldValue: tzs(r.preview?.oldTotal ?? r.sale_total),
        newLabel: 'New Total',
        newValue: r.preview ? tzs(r.preview.newTotal) : '—',
        detailLines: describeSaleEditChanges(r, saleCache),
        reviewedByName: r.reviewed_by_name,
        reviewedAt: r.reviewed_at,
        busy: busyKey === key,
        ...(r.status === 'PENDING'
          ? { onApprove: () => actOnSaleRequest(r.id, 'approve'), onReject: () => actOnSaleRequest(r.id, 'reject') }
          : {}),
      };
    });

    const purchaseCards: ApprovalCard[] = purchaseRequests.map((r) => {
      const key = `purchase-${r.id}`;
      return {
        key,
        type: 'purchase',
        status: r.status,
        requesterName: r.requested_by_name ?? 'A staff member',
        requesterRole: r.requested_by_role ? roleLabel(r.requested_by_role) : '',
        createdAt: r.created_at,
        reason: r.reason,
        title: r.reference_number ?? `Purchase #${r.purchase_id}`,
        subtitle: r.supplier_name ?? null,
        oldLabel: 'Old Total',
        oldValue: tzs(r.preview?.oldTotal ?? r.total_cost),
        newLabel: 'New Total',
        newValue: r.preview ? tzs(r.preview.newTotal) : '—',
        detailLines: describePurchaseEditChanges(r, purchaseCache),
        reviewedByName: r.reviewed_by_name,
        reviewedAt: r.reviewed_at,
        busy: busyKey === key,
        ...(r.status === 'PENDING'
          ? { onApprove: () => actOnPurchaseRequest(r.id, 'approve'), onReject: () => actOnPurchaseRequest(r.id, 'reject') }
          : {}),
      };
    });

    return [...priceCards, ...saleCards, ...purchaseCards].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals, saleRequests, purchaseRequests, saleCache, purchaseCache, busyKey]);

  const dateCutoff = useMemo(() => {
    if (dateFilter === 'all') return null;
    const days = dateFilter === 'today' ? 0 : dateFilter === '7d' ? 7 : 30;
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [dateFilter]);

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (dateCutoff && new Date(c.createdAt) < dateCutoff) return false;
      if (q) {
        const haystack = `${c.title} ${c.subtitle ?? ''} ${c.requesterName} ${c.reason ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [cards, typeFilter, dateCutoff, search]);

  const pending = summary?.pending ?? { price: proposals.filter((p) => p.status === 'PENDING').length, sale: 0, purchase: 0, total: 0 };
  const approvedToday = summary?.approvedToday ?? 0;
  const approvedYesterday = summary?.approvedYesterday ?? 0;
  const rejectedToday = summary?.rejectedToday ?? 0;
  const approvedDelta = approvedToday - approvedYesterday;
  const approvedHint =
    approvedToday === 0 && approvedYesterday === 0
      ? 'No approvals yet today'
      : approvedDelta === 0
      ? 'Same as yesterday'
      : approvedDelta > 0
      ? `+${approvedDelta} from yesterday`
      : `${approvedDelta} from yesterday`;

  const TABS: Array<{ key: TypeFilter; label: string; count: number }> = [
    { key: 'all', label: 'All Changes', count: pending.total },
    { key: 'sale', label: 'Sales', count: pending.sale },
    { key: 'purchase', label: 'Purchases', count: pending.purchase },
    { key: 'price', label: 'Products', count: pending.price },
  ];

  return (
    <div>
      <PageHeader
        icon={<ShieldCheck size={20} />}
        title="Change Approval Center"
        subtitle="Review and approve changes to sales, purchases, and product prices before they take effect."
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Pending Approval</p>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600"><Clock size={18} /></div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{pending.total}</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{pending.total > 0 ? 'Requires your attention' : 'All caught up'}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Approved Today</p>
            <div className="rounded-lg bg-green-50 p-2 text-green-700"><CheckCircle2 size={18} /></div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{approvedToday}</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{approvedHint}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Rejected Today</p>
            <div className="rounded-lg bg-danger-50 p-2 text-danger-600"><XCircle size={18} /></div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{rejectedToday}</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{rejectedToday > 0 ? 'Today' : 'No rejections today'}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTypeFilter(t.key)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  typeFilter === t.key ? 'border-green-600 bg-green-50 text-green-700' : 'border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-white dark:bg-[#121a16] text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-50'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                      typeFilter === t.key ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600 dark:text-[#b6c2ba]'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by product, employee, or reason..."
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="w-40">
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="ALL">All Statuses</option>
            </Select>
            <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)} className="w-40">
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </Select>
          </div>

          {loading ? (
            <Card>
              <FullPageSpinner />
            </Card>
          ) : visibleCards.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Layers size={32} />}
                title="Nothing here."
                description="No changes match these filters."
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {visibleCards.map((c) => {
                const meta = TYPE_META[c.type];
                return (
                  <Card key={c.key} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-xs font-bold text-white">
                          {initials(c.requesterName)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">{c.requesterName}</p>
                          <p className="text-xs text-slate-400 dark:text-[#77857c]">{c.requesterRole}</p>
                        </div>
                        <Badge tone={meta.tone} className="flex items-center gap-1">
                          <meta.icon size={11} />
                          {meta.badgeLabel}
                        </Badge>
                        {c.status !== 'PENDING' && (
                          <Badge tone={c.status === 'APPROVED' ? 'green' : 'red'}>{c.status}</Badge>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 dark:text-[#77857c]">{timeAgo(c.createdAt)}</span>
                    </div>

                    <div className="mt-3">
                      <p className="text-sm font-semibold text-slate-800 dark:text-[#eef3ef]">
                        {c.title}
                        {c.subtitle && <span className="font-normal text-slate-400 dark:text-[#77857c]"> — {c.subtitle}</span>}
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-[#77857c]">{c.oldLabel}</p>
                        <p className="text-sm font-semibold text-slate-500 dark:text-[#97a49b]">{c.oldValue}</p>
                      </div>
                      <div className="rounded-lg bg-green-50 px-3 py-2.5">
                        <p className="text-[11px] uppercase tracking-wide text-green-700">{c.newLabel}</p>
                        <p className="text-sm font-semibold text-green-700">{c.newValue}</p>
                      </div>
                    </div>

                    {c.detailLines.length > 0 && (
                      <ul className="mt-3 space-y-0.5 text-[13px] text-slate-600 dark:text-[#b6c2ba]">
                        {c.detailLines.map((line, idx) => (
                          <li key={idx}>{line}</li>
                        ))}
                      </ul>
                    )}

                    {c.reason && (
                      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                        <span className="font-semibold">Reason for change: </span>
                        {c.reason}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] pt-3">
                      <p className="text-xs text-slate-400 dark:text-[#77857c]">
                        {c.status === 'PENDING'
                          ? `Requested on ${formatDate(c.createdAt)}`
                          : `${c.status === 'APPROVED' ? 'Approved' : 'Rejected'} by ${c.reviewedByName ?? 'the owner'} on ${formatDate(c.reviewedAt)}`}
                      </p>
                      {c.status === 'PENDING' && c.onApprove && c.onReject && (
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" loading={c.busy} onClick={c.onReject} icon={<X size={14} />}>
                            Reject
                          </Button>
                          <Button type="button" size="sm" loading={c.busy} onClick={c.onApprove} icon={<Check size={14} />}>
                            Approve
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-[#eef3ef]">
                <IconChip tone="slate" size={28} icon={<Clock size={14} />} />
                Recent Activity
              </h3>
              {statusFilter !== 'ALL' && (
                <button onClick={() => setStatusFilter('ALL')} className="text-xs font-medium text-green-700 hover:underline">
                  View all
                </button>
              )}
            </div>
            {recentActivity.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400 dark:text-[#77857c]">Nothing resolved yet.</p>
            ) : (
              <ul className="space-y-3">
                {recentActivity.map((a) => {
                  const meta = TYPE_META[a.type];
                  const Icon = a.action === 'APPROVED' ? CheckCircle2 : XCircle;
                  return (
                    <li key={a.id} className="flex items-start gap-2.5">
                      <Icon size={16} className={a.action === 'APPROVED' ? 'mt-0.5 flex-shrink-0 text-green-600' : 'mt-0.5 flex-shrink-0 text-danger-500'} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 dark:text-[#d2dbd5]">
                          {meta.badgeLabel} {a.action === 'APPROVED' ? 'approved' : 'rejected'}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-[#97a49b]">{a.label}</p>
                        <p className="text-xs text-slate-400 dark:text-[#77857c]">
                          {timeAgo(a.reviewedAt)}
                          {a.reviewedByName && ` · by ${a.reviewedByName}`}
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
              Use the filters to find a specific request, or start with Pending — that's what's actually waiting on you.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
