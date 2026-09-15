import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  ScrollText,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  X,
  ShoppingCart,
  Truck,
  Database,
  Wallet,
  Receipt,
  Tag,
  Package,
  MoreHorizontal,
  Activity,
  Users as UsersIcon,
  Settings2,
  Clock,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Contact,
  FileText,
} from 'lucide-react';
import { auditLogsApi, usersApi, salesApi, purchasesApi, apiErrorMessage } from '../lib/api';
import { AuditLog, PublicUser, Sale, Purchase } from '../types';
import { tzs, formatDateTime, isoDaysAgo, todayIso } from '../lib/format';
import { Badge, Button, Card, EmptyState, FullPageSpinner, IconChip, Input, PageHeader, Select, Table, Td, Th, THead, Tr, UserAvatar } from '../components/ui';
import { useToast } from '../components/ui/Toast';

/**
 * Audit Log Center (2026-09-12, CLAUDE.md #43) — from the owner's own
 * reference mockup: stat cards with real "vs previous period" trends, a
 * date range + user + action filter row, Feature tab pills, a sortable
 * table, a click-through Event Details side panel, and real pagination.
 * All of it is backed by `GET /audit-logs`'s new filters/pagination/summary
 * (backend/src/db/auditRepo.ts, backend/src/services/auditLogs.service.ts)
 * — nothing here is client-side-only filtering over a pre-fetched list.
 *
 * Two things the mockup showed that this system didn't track before this
 * redesign, both confirmed with the owner rather than guessed at:
 * - A discount above the shop's limit (BR-32) now gets its own real
 *   `DISCOUNT_APPLIED_HIGH` audit entry (sales.service.ts) — previously it
 *   was only visible buried inside the sale's own total. (BR-32 originally
 *   also required the owner's PIN before the sale could complete — that gate
 *   was removed 2026-09-13, CLAUDE.md #66, at the owner's request; this
 *   entry is now the only after-the-fact record of an over-limit discount,
 *   and fires unconditionally rather than only once a PIN had been verified.)
 * - "Status" isn't a stored column — every logged action already succeeded
 *   by construction (writeAuditLog always runs inside the same transaction
 *   as the action itself, so a failed action is never written). Status
 *   reads "Warning" only for DISCOUNT_APPLIED_HIGH and "Success" for
 *   everything else, rather than a fabricated field with no real meaning.
 */

const FEATURES = [
  'All',
  'Sales',
  'Purchases',
  'Stock',
  'Cash',
  'Expenses',
  'Price Proposals',
  'Products',
  'Users',
  'Customers',
  'Quotations',
  'Settings',
  'Others',
] as const;
type Feature = (typeof FEATURES)[number];

const FEATURE_ICON: Record<string, typeof ShoppingCart> = {
  Sales: ShoppingCart,
  Purchases: Truck,
  Stock: Database,
  Cash: Wallet,
  Expenses: Receipt,
  'Price Proposals': Tag,
  Products: Package,
  Users: UsersIcon,
  // Customers + Quotations + Settings (2026-09-12, CLAUDE.md #49).
  Customers: Contact,
  Quotations: FileText,
  Settings: Settings2,
  Others: MoreHorizontal,
};

const ACTION_META: Record<string, { label: string; tone: 'green' | 'blue' | 'red' | 'amber' | 'slate' }> = {
  SALE_COMPLETED: { label: 'Sale Completed', tone: 'green' },
  SALE_VOIDED: { label: 'Void Sale', tone: 'red' },
  SALE_DETAILS_UPDATED: { label: 'Sale Details Updated', tone: 'blue' },
  SALE_EDITED: { label: 'Sale Edited', tone: 'blue' },
  SALE_EDIT_REQUESTED: { label: 'Sale Edit Requested', tone: 'amber' },
  SALE_EDIT_APPROVED: { label: 'Sale Edit Approved', tone: 'green' },
  SALE_EDIT_REJECTED: { label: 'Sale Edit Rejected', tone: 'red' },
  DISCOUNT_APPLIED_HIGH: { label: 'Discount Applied (High)', tone: 'amber' },
  // Credit sales (2026-09-12, CLAUDE.md #50) — topping up a PARTIAL sale.
  PAYMENT_RECORDED: { label: 'Payment Recorded', tone: 'green' },
  PURCHASE_RECORDED: { label: 'Purchase Recorded', tone: 'blue' },
  PURCHASE_EDITED: { label: 'Purchase Edited', tone: 'blue' },
  PURCHASE_EDIT_REQUESTED: { label: 'Purchase Edit Requested', tone: 'amber' },
  PURCHASE_EDIT_APPROVED: { label: 'Purchase Edit Approved', tone: 'green' },
  PURCHASE_EDIT_REJECTED: { label: 'Purchase Edit Rejected', tone: 'red' },
  STOCK_ADJUSTED: { label: 'Stock Adjustment', tone: 'amber' },
  STOCK_COUNT_RECORDED: { label: 'Stock Count', tone: 'blue' },
  STOCK_COUNT_APPROVED: { label: 'Stock Count Approved', tone: 'green' },
  STOCK_COUNT_REJECTED: { label: 'Stock Count Rejected', tone: 'red' },
  CASH_COUNT_RECORDED: { label: 'Cash Count', tone: 'blue' },
  EXPENSE_RECORDED: { label: 'Expense Recorded', tone: 'amber' },
  PRICE_PROPOSED: { label: 'Price Proposed', tone: 'blue' },
  PRICE_APPROVED: { label: 'Price Proposal Approved', tone: 'green' },
  PRICE_REJECTED: { label: 'Price Proposal Rejected', tone: 'red' },
  PRODUCT_ACTIVATED: { label: 'Product Activated', tone: 'green' },
  PRODUCT_DEACTIVATED: { label: 'Product Deactivated', tone: 'red' },
  USER_PASSWORD_RESET: { label: 'Password Reset', tone: 'amber' },
  USER_PASSWORD_CHANGED: { label: 'Password Changed', tone: 'blue' },
  USER_PROFILE_UPDATED: { label: 'Profile Updated', tone: 'blue' },
  // Customers + Quotations + Settings (2026-09-12, CLAUDE.md #49).
  CUSTOMER_CREATED: { label: 'Customer Created', tone: 'green' },
  CUSTOMER_UPDATED: { label: 'Customer Updated', tone: 'blue' },
  QUOTATION_CREATED: { label: 'Quotation Created', tone: 'green' },
  QUOTATION_STATUS_CHANGED: { label: 'Quotation Status Changed', tone: 'blue' },
  QUOTATION_CONVERTED: { label: 'Quotation Converted', tone: 'green' },
  BUSINESS_SETTINGS_UPDATED: { label: 'Business Settings Updated', tone: 'amber' },
};

function actionMeta(action: string) {
  return ACTION_META[action] ?? { label: action.replaceAll('_', ' '), tone: 'slate' as const };
}

function labelize(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const MONEY_KEYS = ['total', 'totalCost', 'amount', 'discountAmount', 'expectedCash', 'actualCash', 'difference', 'from', 'to', 'proposedPrice'];
const HIDDEN_KEYS = ['editRequestId', 'stockCountId', 'adjustmentId', 'proposalId'];

/** A short, human-readable one-line summary of an entry's `details` JSON —
 * built only from fields the backend actually stored for that action (see
 * each service's own `writeAuditLog` call), never invented. */
function summarizeDetails(action: string, details: Record<string, unknown> | null): string {
  const d: Record<string, any> = details ?? {};
  const money = (v: unknown) => (v === undefined || v === null ? '—' : tzs(v as any));
  switch (action) {
    case 'SALE_COMPLETED':
      return `Invoice #${d.invoiceNumber ?? '—'} · ${money(d.total)} · ${d.itemCount ?? 0} item${d.itemCount === 1 ? '' : 's'}`;
    case 'SALE_VOIDED':
      return `Invoice #${d.invoiceNumber ?? '—'} · Reason: ${d.reason ?? '—'}`;
    case 'DISCOUNT_APPLIED_HIGH':
      return `${money(d.discountAmount)} (${d.effectivePct}%, limit ${d.maxPct}%) · Invoice #${d.invoiceNumber ?? '—'}`;
    case 'PURCHASE_RECORDED':
      return `Ref #${d.referenceNumber ?? '—'} · ${money(d.totalCost)} · ${d.itemCount ?? 0} item${d.itemCount === 1 ? '' : 's'}`;
    case 'STOCK_ADJUSTED':
      return `${Number(d.quantity) > 0 ? '+' : ''}${d.quantity ?? '—'} units · Reason: ${d.reason ?? '—'}`;
    case 'STOCK_COUNT_RECORDED':
      return `Expected ${d.expectedQty ?? '—'} · Counted ${d.physicalQty ?? '—'} · Diff ${d.difference ?? '—'}`;
    case 'STOCK_COUNT_APPROVED':
    case 'STOCK_COUNT_REJECTED':
      return d.difference !== undefined ? `Difference: ${d.difference}` : '—';
    case 'CASH_COUNT_RECORDED':
      return `Expected ${money(d.expectedCash)} · Counted ${money(d.actualCash)} (Diff ${money(d.difference)})`;
    case 'EXPENSE_RECORDED':
      return `${d.category ?? '—'} · ${money(d.amount)}${d.expenseType ? ` · ${d.expenseType}` : ''}`;
    case 'PRICE_PROPOSED':
    case 'PRICE_APPROVED':
    case 'PRICE_REJECTED':
      return d.to !== undefined ? `${money(d.from)} → ${money(d.to)}` : `Proposed: ${money(d.proposedPrice)}${d.notes ? ` · ${d.notes}` : ''}`;
    case 'PRODUCT_ACTIVATED':
    case 'PRODUCT_DEACTIVATED':
      return `${d.name ?? '—'}`;
    default: {
      const parts = Object.entries(d)
        .filter(([k]) => !HIDDEN_KEYS.includes(k))
        .map(([k, v]) => `${labelize(k)}: ${typeof v === 'boolean' ? (v ? 'Yes' : 'No') : MONEY_KEYS.includes(k) ? money(v) : v}`);
      return parts.length ? parts.join(' · ') : '—';
    }
  }
}

function TrendChip({ kind, value }: { kind: 'pct' | 'delta'; value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400 dark:text-[#77857c]">No prior period to compare</span>;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  const text = kind === 'pct' ? `${value > 0 ? '+' : ''}${value.toFixed(0)}%` : `${value > 0 ? '+' : ''}${value}`;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-[#97a49b]">
      <Icon size={12} />
      {text} vs previous period
    </span>
  );
}

function SortableTh({
  label,
  sortKey,
  activeSort,
  activeDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  activeSort: string;
  activeDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  className?: string;
}) {
  const Icon = activeSort !== sortKey ? ChevronsUpDown : activeDir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <Th className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-green-700">
        {label}
        <Icon size={12} className={activeSort === sortKey ? 'text-green-700' : 'text-slate-400 dark:text-[#77857c]'} />
      </button>
    </Th>
  );
}

// ---------------------------------------------------------------------------
// Event Details side panel
// ---------------------------------------------------------------------------

function EventDetailsPanel({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  const toast = useToast();
  const [sale, setSale] = useState<Sale | null>(null);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loadingEntity, setLoadingEntity] = useState(false);

  useEffect(() => {
    setSale(null);
    setPurchase(null);
    if (log.entity_type === 'sale' && log.entity_id) {
      setLoadingEntity(true);
      salesApi
        .get(log.entity_id)
        .then((r) => setSale(r.data))
        .catch(() => {
          /* the sale may have been removed from view (e.g. permissions) — details JSON below still shows */
        })
        .finally(() => setLoadingEntity(false));
    } else if (log.entity_type === 'purchase' && log.entity_id) {
      setLoadingEntity(true);
      purchasesApi
        .get(log.entity_id)
        .then((r) => setPurchase(r.data))
        .catch(() => {})
        .finally(() => setLoadingEntity(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.id]);

  const meta = actionMeta(log.action);
  const FeatureIcon = FEATURE_ICON[log.feature] ?? MoreHorizontal;
  const description = summarizeDetails(log.action, log.details);
  const details = log.details ?? {};

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col bg-white dark:bg-[#121a16] shadow-panel animate-fade-in sm:w-[420px]">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-4">
          <div className="flex items-center gap-3">
            <IconChip tone={meta.tone === 'red' ? 'red' : meta.tone === 'amber' ? 'amber' : meta.tone === 'blue' ? 'blue' : 'green'} size={40} icon={<FeatureIcon size={18} />} />
            <div>
              <p className="font-bold text-slate-800 dark:text-[#eef3ef]">{meta.label}</p>
              <p className="text-xs text-slate-400 dark:text-[#77857c]">{log.feature}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-[#77857c] hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400 dark:text-[#77857c]">Date &amp; Time</dt>
              <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">{formatDateTime(log.created_at)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400 dark:text-[#77857c]">User</dt>
              <dd className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-[#d2dbd5]">
                {log.user_name && <UserAvatar name={log.user_name} />}
                {log.user_name ?? '—'}
              </dd>
            </div>

            {sale && (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400 dark:text-[#77857c]">Invoice No.</dt>
                  <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">{sale.invoice_number}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400 dark:text-[#77857c]">Total Amount</dt>
                  <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(sale.total)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400 dark:text-[#77857c]">Payment Method</dt>
                  <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">Cash</dd>
                </div>
              </>
            )}

            {purchase && (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400 dark:text-[#77857c]">Reference No.</dt>
                  <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">{purchase.reference_number}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400 dark:text-[#77857c]">Supplier</dt>
                  <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">{purchase.supplier_name ?? '—'}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400 dark:text-[#77857c]">Total Cost</dt>
                  <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(purchase.total_cost)}</dd>
                </div>
              </>
            )}

            {!sale && !purchase && log.entity_type && (
              <div className="flex items-center justify-between">
                <dt className="text-slate-400 dark:text-[#77857c]">Entity</dt>
                <dd className="font-medium text-slate-700 dark:text-[#d2dbd5]">
                  {log.entity_type} #{log.entity_id}
                </dd>
              </div>
            )}
          </dl>

          {loadingEntity && <p className="mt-3 text-xs text-slate-400 dark:text-[#77857c]">Loading full record…</p>}

          {sale && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Items Sold</p>
              <div className="space-y-1.5">
                {sale.items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-[#b6c2ba]">
                      {it.product_name} <span className="text-slate-400 dark:text-[#77857c]">x{it.quantity}</span>
                    </span>
                    <span className="font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(it.line_total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {purchase && purchase.items && purchase.items.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Items Purchased</p>
              <div className="space-y-1.5">
                {purchase.items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-[#b6c2ba]">
                      {it.product_name} <span className="text-slate-400 dark:text-[#77857c]">x{it.quantity}</span>
                    </span>
                    <span className="font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(it.total_cost)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!sale && !purchase && Object.keys(details).length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Details</p>
              <div className="space-y-1.5">
                {Object.entries(details)
                  .filter(([k]) => !HIDDEN_KEYS.includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-sm">
                      <span className="text-slate-400 dark:text-[#77857c]">{labelize(k)}</span>
                      <span className="font-medium text-slate-700 dark:text-[#d2dbd5]">
                        {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : MONEY_KEYS.includes(k) ? tzs(v as any) : String(v)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="mt-5 rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500 dark:text-[#97a49b]">{description}</div>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-green-50 px-3.5 py-2.5 text-xs text-green-800">
            <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
            This event is part of the audit trail and cannot be edited or deleted.
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AuditLogPage() {
  const toast = useToast();

  const [draftFrom, setDraftFrom] = useState(isoDaysAgo(30));
  const [draftTo, setDraftTo] = useState(todayIso());
  const [from, setFrom] = useState(draftFrom);
  const [to, setTo] = useState(draftTo);
  const [draftUserId, setDraftUserId] = useState<string>('');
  const [draftAction, setDraftAction] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [action, setAction] = useState<string>('');

  const [feature, setFeature] = useState<Feature>('All');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [data, setData] = useState<{ rows: AuditLog[]; pagination: { page: number; pageSize: number; totalRows: number; totalPages: number }; summary: any } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  useEffect(() => {
    usersApi.list().then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    auditLogsApi
      .list({
        from,
        to,
        user_id: userId ? Number(userId) : undefined,
        action: action || undefined,
        feature: feature === 'All' ? undefined : feature,
        page,
        page_size: 15,
        sort_by: sortBy,
        sort_dir: sortDir,
      })
      .then((r) => setData(r.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load the audit log.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, userId, action, feature, page, sortBy, sortDir]);

  useEffect(() => setPage(1), [from, to, userId, action, feature]);

  function handleSort(key: string) {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  }

  const summary = data?.summary;
  const rows = data?.rows ?? [];
  const pagination = data?.pagination;

  return (
    <div>
      <PageHeader
        icon={<ScrollText size={20} />}
        title="Audit Log"
        subtitle="Track all important activities in your store. See who did what, when, and more."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange size={16} className="hidden text-slate-400 dark:text-[#77857c] sm:block" />
            <Input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} max={draftTo} className="w-auto" />
            <span className="text-xs text-slate-400 dark:text-[#77857c]">to</span>
            <Input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} min={draftFrom} max={todayIso()} className="w-auto" />
            <Select value={draftUserId} onChange={(e) => setDraftUserId(e.target.value)} className="w-auto">
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Select value={draftAction} onChange={(e) => setDraftAction(e.target.value)} className="w-auto">
              <option value="">All Actions</option>
              {Object.entries(ACTION_META).map(([code, m]) => (
                <option key={code} value={code}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setFrom(draftFrom);
                setTo(draftTo);
                setUserId(draftUserId);
                setAction(draftAction);
              }}
            >
              Apply
            </Button>
          </div>
        }
      />

      {loading && !data ? (
        <FullPageSpinner />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Total Events</p>
                <div className="rounded-lg bg-green-50 p-2 text-green-700">
                  <Activity size={18} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{summary?.totalEvents ?? 0}</p>
              <div className="mt-1">
                <TrendChip kind="pct" value={summary?.trend.totalEventsPct ?? null} />
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Unique Users</p>
                <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
                  <UsersIcon size={18} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{summary?.uniqueUsers ?? 0}</p>
              <div className="mt-1">
                <TrendChip kind="delta" value={summary?.trend.uniqueUsersDelta ?? null} />
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Different Actions</p>
                <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
                  <Settings2 size={18} />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">{summary?.differentActions ?? 0}</p>
              <div className="mt-1">
                <TrendChip kind="delta" value={summary?.trend.differentActionsDelta ?? null} />
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500 dark:text-[#97a49b]">Latest Activity</p>
                <div className="rounded-lg bg-purple-50 p-2 text-purple-700">
                  <Clock size={18} />
                </div>
              </div>
              <p className="mt-2 text-lg font-bold text-slate-800 dark:text-[#eef3ef]">
                {summary?.latestActivity ? formatDateTime(summary.latestActivity.createdAt) : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">By {summary?.latestActivity?.userName ?? '—'}</p>
            </Card>
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {FEATURES.map((f) => {
              const Icon = f === 'All' ? Activity : FEATURE_ICON[f];
              return (
                <button
                  key={f}
                  onClick={() => setFeature(f)}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                    feature === f ? 'bg-green-600 text-white shadow-card' : 'bg-white dark:bg-[#121a16] text-slate-600 dark:text-[#b6c2ba] border border-slate-200 dark:border-[rgba(255,255,255,0.14)] hover:bg-slate-50'
                  )}
                >
                  <Icon size={14} />
                  {f}
                </button>
              );
            })}
          </div>

          <Card>
            {rows.length === 0 ? (
              <EmptyState title="No audit entries match these filters." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>#</Th>
                    <SortableTh label="Date & Time" sortKey="created_at" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                    <SortableTh label="Action" sortKey="action" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                    <SortableTh label="User" sortKey="user_name" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                    <Th>Feature</Th>
                    <SortableTh label="Details" sortKey="details" activeSort={sortBy} activeDir={sortDir} onSort={handleSort} />
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((log, i) => {
                    const meta = actionMeta(log.action);
                    const FeatureIcon = FEATURE_ICON[log.feature] ?? MoreHorizontal;
                    return (
                      <Tr key={log.id} onClick={() => setSelected(log)} className="cursor-pointer">
                        <Td className="text-slate-400 dark:text-[#77857c]">{(pagination!.page - 1) * pagination!.pageSize + i + 1}</Td>
                        <Td className="text-xs text-slate-500 dark:text-[#97a49b]">{formatDateTime(log.created_at)}</Td>
                        <Td>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </Td>
                        <Td>
                          <span className="flex items-center gap-1.5">
                            {log.user_name && <UserAvatar name={log.user_name} />}
                            {log.user_name ?? '—'}
                          </span>
                        </Td>
                        <Td>
                          <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-[#97a49b]">
                            <FeatureIcon size={13} />
                            {log.feature}
                          </span>
                        </Td>
                        <Td className="max-w-xs truncate text-xs text-slate-500 dark:text-[#97a49b]">
                          <span title={summarizeDetails(log.action, log.details)}>{summarizeDetails(log.action, log.details)}</span>
                        </Td>
                        <Td>
                          <Badge tone={log.status === 'Warning' ? 'amber' : 'green'}>{log.status}</Badge>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}

            {pagination && pagination.totalRows > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-3">
                <p className="text-xs text-slate-400 dark:text-[#77857c]">
                  Showing {(pagination.page - 1) * pagination.pageSize + 1}–
                  {Math.min(pagination.page * pagination.pageSize, pagination.totalRows)} of {pagination.totalRows} events
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  {(() => {
                    const total = pagination.totalPages;
                    const cur = pagination.page;
                    const nums: number[] = [];
                    for (let n = Math.max(1, cur - 2); n <= Math.min(total, cur + 2); n++) nums.push(n);
                    return nums.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(n)}
                        className={clsx(
                          'flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium',
                          n === cur ? 'bg-green-600 text-white' : 'border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-50'
                        )}
                      >
                        {n}
                      </button>
                    ));
                  })()}
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {selected && <EventDetailsPanel log={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
