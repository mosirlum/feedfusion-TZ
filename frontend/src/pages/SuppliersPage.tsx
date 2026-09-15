import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  History,
  Pencil,
  Search,
  Download,
  X,
  Phone,
  MapPin,
  Users,
  ShoppingCart,
  Wallet,
  Sparkles,
  PieChart,
  BarChart3,
  Lightbulb,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { suppliersApi, apiErrorMessage } from '../lib/api';
import { Supplier, Purchase, SupplierStats } from '../types';
import { tzs, formatDate, initials } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  CHART_COLORS,
  DonutChart,
  EmptyState,
  FormField,
  FullPageSpinner,
  IconChip,
  Input,
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
import { isValidTzPhone, sanitizePhoneInput, TZ_PHONE_PLACEHOLDER, TZ_PHONE_HINT, TZ_PHONE_ERROR } from '../lib/phone';

// Chart colors sampled from the app's own brand palette (tailwind.config.js)
// rather than a generic chart-library default, so "Purchase Share by
// Supplier" reads as part of the same design system as everything else.

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// Suppliers page redesign (2026-09-11) — see CLAUDE.md for the full
// writeup and the judgment calls made while building this (which mockup
// fields were dropped, why "Avg Delivery Time" isn't real, etc).
export default function SuppliersPage() {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<SupplierStats | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [locationFilter, setLocationFilter] = useState('all');

  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'history' | 'analysis'>('overview');
  const [detailHistory, setDetailHistory] = useState<Purchase[] | null>(null);

  function load() {
    setLoading(true);
    suppliersApi
      .list()
      .then((res) => setSuppliers(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load suppliers.')))
      .finally(() => setLoading(false));
  }
  function loadStats() {
    suppliersApi
      .stats()
      .then((res) => setStats(res.data))
      .catch(() => {
        // Non-fatal — the stat cards/charts just show a lighter fallback.
      });
  }

  useEffect(() => {
    load();
    loadStats();
  }, []);

  function openDetail(s: Supplier, tab: 'overview' | 'history' | 'analysis' = 'overview') {
    setDetailSupplier(s);
    setDetailTab(tab);
    setDetailHistory(null);
    suppliersApi
      .purchases(s.id)
      .then((res) => setDetailHistory(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load purchase history.')));
  }
  function closeDetail() {
    setDetailSupplier(null);
    setDetailHistory(null);
  }

  function openCreate() {
    setEditingSupplier(null);
    setFormOpen(true);
  }
  function openEdit(s: Supplier) {
    setEditingSupplier(s);
    setFormOpen(true);
  }

  function afterSave(updated: Supplier) {
    setFormOpen(false);
    load();
    loadStats();
    if (detailSupplier?.id === updated.id) setDetailSupplier(updated);
  }

  // ---------------------------------------------------------------------------
  // Filtering (client-side — a shop's supplier list is small enough that a
  // dedicated search endpoint isn't worth it)
  // ---------------------------------------------------------------------------
  const locations = useMemo(
    () => Array.from(new Set(suppliers.map((s) => s.address).filter((a): a is string => !!a && a.trim() !== ''))).sort(),
    [suppliers]
  );

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (locationFilter !== 'all' && s.address !== locationFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? '').toLowerCase().includes(q) ||
        (s.address ?? '').toLowerCase().includes(q)
      );
    });
  }, [suppliers, search, statusFilter, locationFilter]);

  function exportCsv() {
    const header = ['Name', 'Phone', 'Location', 'Total Purchases (TZS)', 'Purchases', 'Last Purchase', 'Status'];
    const rows = filteredSuppliers.map((s) => [
      s.name,
      s.phone ?? '',
      s.address ?? '',
      s.total_purchases ?? '0',
      String(s.purchase_count ?? 0),
      s.last_purchase_date ? formatDate(s.last_purchase_date) : '',
      s.status,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suppliers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Top stat cards + charts + insights — all derived from GET /suppliers/stats
  // ---------------------------------------------------------------------------
  const totalThisMonth = Number(stats?.total_this_month ?? 0);
  const totalLastMonth = Number(stats?.total_last_month ?? 0);
  const monthChangePct = totalLastMonth > 0 ? ((totalThisMonth - totalLastMonth) / totalLastMonth) * 100 : null;

  const activeBySpend = (stats?.bySupplier ?? []).filter((s) => Number(s.total_cost_this_month) > 0);
  const topSupplierThisMonth = activeBySpend[0] ?? null;
  const topSupplierSharePct =
    topSupplierThisMonth && totalThisMonth > 0 ? (Number(topSupplierThisMonth.total_cost_this_month) / totalThisMonth) * 100 : null;

  const insights: string[] = [];
  if (stats) {
    if (topSupplierThisMonth && topSupplierSharePct !== null) {
      insights.push(`${topSupplierThisMonth.name} is your top supplier this month (${topSupplierSharePct.toFixed(0)}% of total spend).`);
    }
    if (monthChangePct !== null) {
      insights.push(
        `Purchase volume ${monthChangePct >= 0 ? 'increased' : 'decreased'} by ${Math.abs(monthChangePct).toFixed(0)}% compared to last month.`
      );
    } else if (totalThisMonth > 0) {
      insights.push('This is the first month with recorded purchases from these suppliers — nothing to compare yet.');
    }
    if (stats.new_suppliers_this_month > 0) {
      insights.push(`${stats.new_suppliers_this_month} new supplier${stats.new_suppliers_this_month > 1 ? 's' : ''} added this month.`);
    }
  }

  // Top 5 suppliers by this-month spend get their own donut slice; the rest
  // are folded into "Others" so the share chart stays readable — a share-of-
  // whole chart doesn't page well, so this one keeps a cap rather than the
  // pagination used for the ranked list below.
  const donutSlices = useMemo(() => {
    const top = activeBySpend.slice(0, 5).map((s) => ({ name: s.name, value: Number(s.total_cost_this_month) }));
    const rest = activeBySpend.slice(5).reduce((sum, s) => sum + Number(s.total_cost_this_month), 0);
    if (rest > 0) top.push({ name: 'Others', value: rest });
    return top.map((s, i) => ({ ...s, color: CHART_COLORS[i % CHART_COLORS.length], pct: totalThisMonth > 0 ? (s.value / totalThisMonth) * 100 : 0 }));
  }, [activeBySpend, totalThisMonth]);

  // "Top Suppliers by Purchase Value" is a ranked list, not a share of a
  // whole, so instead of an opaque "Others" bucket it pages through every
  // active supplier with any purchase history, 5 per page. This is
  // deliberately scoped to ALL-TIME purchase value (Supplier.total_purchases,
  // already returned by GET /suppliers), not "this month" like the donut
  // and stat cards above — a shop with, say, 8 suppliers but only 2 who
  // delivered this calendar month would otherwise never see a second page
  // no matter how many suppliers it has (2026-09-11 follow-up, per the
  // owner's "5 suppliers on page 1 then continue page 2").
  const RANKED_PAGE_SIZE = 5;
  const [rankedPage, setRankedPage] = useState(0);
  const rankedSuppliers = useMemo(() => {
    const activeWithHistory = suppliers.filter((s) => s.status === 'active' && Number(s.total_purchases ?? 0) > 0);
    const totalAllTime = activeWithHistory.reduce((sum, s) => sum + Number(s.total_purchases ?? 0), 0);
    return activeWithHistory
      .slice()
      .sort((a, b) => Number(b.total_purchases ?? 0) - Number(a.total_purchases ?? 0))
      .map((s, i) => ({
        name: s.name,
        value: Number(s.total_purchases ?? 0),
        color: CHART_COLORS[i % CHART_COLORS.length],
        pct: totalAllTime > 0 ? (Number(s.total_purchases ?? 0) / totalAllTime) * 100 : 0,
      }));
  }, [suppliers]);
  const rankedPageCount = Math.max(1, Math.ceil(rankedSuppliers.length / RANKED_PAGE_SIZE));
  const rankedPageSafe = Math.min(rankedPage, rankedPageCount - 1);
  const rankedPageItems = rankedSuppliers.slice(rankedPageSafe * RANKED_PAGE_SIZE, rankedPageSafe * RANKED_PAGE_SIZE + RANKED_PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Manage your suppliers, view history, and track their performance."
        action={<Button icon={<Plus size={16} />} onClick={openCreate}>Add New Supplier</Button>}
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Suppliers" value={stats?.total_suppliers ?? suppliers.filter((s) => s.status === 'active').length} icon={<Users size={18} />} tone="green" hint="Active suppliers" />
        <StatCard
          label="Total Purchases"
          value={tzs(totalThisMonth)}
          icon={<ShoppingCart size={18} />}
          tone="blue"
          hint={monthChangePct !== null ? `${monthChangePct >= 0 ? '↑' : '↓'} ${Math.abs(monthChangePct).toFixed(0)}% vs last month` : 'This month'}
        />
        <StatCard
          label="Top Supplier"
          value={topSupplierThisMonth?.name ?? '—'}
          icon={<Wallet size={18} />}
          tone="amber"
          hint={topSupplierSharePct !== null ? `${topSupplierSharePct.toFixed(0)}% of this month's spend` : 'No purchases yet this month'}
        />
        <StatCard
          label="Purchases This Month"
          value={stats?.purchase_count_this_month ?? 0}
          icon={<Sparkles size={18} />}
          tone="green"
          hint="Deliveries recorded this month"
        />
      </div>

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or location…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="sm:w-40">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="sm:w-48">
          <option value="all">All Locations</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" icon={<Download size={15} />} onClick={exportCsv} disabled={filteredSuppliers.length === 0}>
          Export
        </Button>
      </Card>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : suppliers.length === 0 ? (
          <EmptyState title="No suppliers yet." action={<Button onClick={openCreate}>Add the first supplier</Button>} />
        ) : filteredSuppliers.length === 0 ? (
          <EmptyState title="No suppliers match those filters." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Supplier</Th>
                <Th>Phone</Th>
                <Th>Location</Th>
                <Th className="text-right">Total Purchases</Th>
                <Th>Last Purchase</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </THead>
            <tbody>
              {filteredSuppliers.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <button onClick={() => openDetail(s)} className="flex items-center gap-2.5 text-left hover:opacity-80">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-[11px] font-bold text-white">
                        {initials(s.name)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800 dark:text-[#eef3ef]">{s.name}</p>
                        <p className="text-xs text-slate-400 dark:text-[#77857c]">SUP-{String(s.id).padStart(3, '0')}</p>
                      </div>
                    </button>
                  </Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">{s.phone ?? '—'}</Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">
                    {s.address ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin size={13} className="flex-shrink-0 text-slate-400 dark:text-[#77857c]" />
                        {s.address}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-right font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(s.total_purchases)}</Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">{s.last_purchase_date ? formatDate(s.last_purchase_date) : '—'}</Td>
                  <Td>
                    <Badge tone={s.status === 'active' ? 'green' : 'slate'}>{s.status}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => openDetail(s, 'history')} className="text-slate-400 dark:text-[#77857c] hover:text-blue-600" title="Purchase history">
                        <History size={16} />
                      </button>
                      <button onClick={() => openEdit(s)} className="text-slate-400 dark:text-[#77857c] hover:text-amber-600" title="Edit supplier">
                        <Pencil size={16} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {!loading && suppliers.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <IconChip tone="green" icon={<PieChart size={17} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Purchase Share by Supplier</h3>
            </div>
            {donutSlices.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-slate-400 dark:text-[#77857c]">No purchases recorded yet this month.</p>
            ) : (
              <div className="flex items-center gap-5">
                <DonutChart slices={donutSlices} centerValue={tzs(totalThisMonth)} centerLabel="This month" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {donutSlices.map((slice) => (
                    <div key={slice.name} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-600 dark:text-[#b6c2ba]">
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                        <span className="truncate">{slice.name}</span>
                      </span>
                      <span className="flex-shrink-0 font-semibold text-slate-700 dark:text-[#d2dbd5]">{slice.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconChip tone="blue" icon={<BarChart3 size={17} />} />
                <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Top Suppliers by Purchase Value</h3>
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">All-time</span>
            </div>
            {rankedSuppliers.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-slate-400 dark:text-[#77857c]">No purchases recorded yet.</p>
            ) : (
              <>
                <div className="space-y-3">
                  {rankedPageItems.map((slice) => (
                    <div key={slice.name}>
                      <div className="mb-1 flex items-center justify-between text-[12.5px]">
                        <span className="truncate text-slate-600 dark:text-[#b6c2ba]">{slice.name}</span>
                        <span className="font-semibold text-slate-700 dark:text-[#d2dbd5]">{tzs(slice.value)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-[#0e1512]">
                        <div className="h-full rounded-full" style={{ width: `${slice.pct}%`, backgroundColor: slice.color }} />
                      </div>
                    </div>
                  ))}
                </div>
                {rankedPageCount > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[11.5px] text-slate-400 dark:text-[#77857c]">
                      Page {rankedPageSafe + 1} of {rankedPageCount}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setRankedPage((p) => Math.max(0, p - 1))}
                        disabled={rankedPageSafe === 0}
                        className="rounded-md px-2 py-1 text-slate-400 dark:text-[#77857c] hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronLeft size={15} />
                      </button>
                      {Array.from({ length: rankedPageCount }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setRankedPage(i)}
                          className={`h-6 w-6 rounded-md text-[12px] font-semibold ${
                            i === rankedPageSafe ? 'bg-green-600 text-white' : 'text-slate-500 dark:text-[#97a49b] hover:bg-slate-100'
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <button
                        onClick={() => setRankedPage((p) => Math.min(rankedPageCount - 1, p + 1))}
                        disabled={rankedPageSafe === rankedPageCount - 1}
                        className="rounded-md px-2 py-1 text-slate-400 dark:text-[#77857c] hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <IconChip tone="amber" icon={<Lightbulb size={17} />} />
              <h3 className="font-bold text-slate-800 dark:text-[#eef3ef]">Insights</h3>
            </div>
            {insights.length === 0 ? (
              <p className="text-[13px] text-slate-400 dark:text-[#77857c]">Nothing notable yet — insights build up as purchases are recorded.</p>
            ) : (
              <ul className="space-y-2.5">
                {insights.map((line, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-[13px] text-slate-600 dark:text-[#b6c2ba]">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-600" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <SupplierFormModal open={formOpen} onClose={() => setFormOpen(false)} editing={editingSupplier} onSaved={afterSave} />

      <SupplierDetailPanel
        supplier={detailSupplier}
        tab={detailTab}
        onTabChange={setDetailTab}
        history={detailHistory}
        stats={stats}
        onClose={closeDetail}
        onEdit={(s) => {
          closeDetail();
          openEdit(s);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail slide-over panel — Overview / Purchase History / Analysis, replacing
// the old plain "purchase history" modal.
// ---------------------------------------------------------------------------
function SupplierDetailPanel({
  supplier,
  tab,
  onTabChange,
  history,
  stats,
  onClose,
  onEdit,
}: {
  supplier: Supplier | null;
  tab: 'overview' | 'history' | 'analysis';
  onTabChange: (tab: 'overview' | 'history' | 'analysis') => void;
  history: Purchase[] | null;
  stats: SupplierStats | null;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
}) {
  if (!supplier) return null;

  const totalSpent = history ? history.reduce((sum, p) => sum + Number(p.total_cost), 0) : null;
  const purchaseCount = history?.length ?? null;
  const avgOrder = totalSpent !== null && purchaseCount ? totalSpent / purchaseCount : null;
  const lastPurchase = history && history.length > 0 ? history[0] : null;

  const months = (() => {
    if (!history) return [];
    const byMonth = new Map<string, number>();
    for (const p of history) {
      const key = p.purchase_date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(p.total_cost));
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
      .reverse();
  })();
  const maxMonth = months.reduce((max, [, v]) => Math.max(max, v), 0);

  const thisMonthEntry = stats?.bySupplier.find((b) => b.id === supplier.id);
  const thisMonthTotal = Number(thisMonthEntry?.total_cost_this_month ?? 0);
  const shareOfThisMonth =
    stats && Number(stats.total_this_month) > 0 ? (thisMonthTotal / Number(stats.total_this_month)) * 100 : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col bg-white dark:bg-[#121a16] shadow-panel animate-fade-in sm:w-[420px]">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-green-600 text-sm font-bold text-white">
              {initials(supplier.name)}
            </div>
            <div>
              <p className="font-bold text-slate-800 dark:text-[#eef3ef]">{supplier.name}</p>
              <p className="text-xs text-slate-400 dark:text-[#77857c]">
                SUP-{String(supplier.id).padStart(3, '0')} · Supplier{' '}
                <Badge tone={supplier.status === 'active' ? 'green' : 'slate'} className="ml-1">
                  {supplier.status}
                </Badge>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-[#77857c] hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5">
          {[
            { key: 'overview' as const, label: 'Overview' },
            { key: 'history' as const, label: 'Purchase History' },
            { key: 'analysis' as const, label: 'Analysis' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key)}
              className={`border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === t.key ? 'border-green-600 text-green-700' : 'border-transparent text-slate-400 dark:text-[#77857c] hover:text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'overview' && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Supplier Information</p>
                <div className="space-y-2.5 rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] bg-slate-50/50 p-4 text-[13px]">
                  <div className="flex items-center gap-2 text-slate-600 dark:text-[#b6c2ba]">
                    <Phone size={14} className="text-slate-400 dark:text-[#77857c]" /> {supplier.phone ?? 'No phone on file'}
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-[#b6c2ba]">
                    <MapPin size={14} className="text-slate-400 dark:text-[#77857c]" /> {supplier.address ?? 'No location on file'}
                  </div>
                  {supplier.notes && <p className="text-slate-500 dark:text-[#97a49b]">{supplier.notes}</p>}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Quick Actions</p>
                <div className="space-y-1.5">
                  <button
                    onClick={() => onTabChange('history')}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-3.5 py-3 text-left hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2.5">
                      <IconChip tone="green" size={30} icon={<History size={14} />} />
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-700 dark:text-[#d2dbd5]">View Purchase History</span>
                        <span className="block text-[11.5px] text-slate-400 dark:text-[#77857c]">See all past purchases and invoices</span>
                      </span>
                    </span>
                    <ChevronRight size={16} className="text-slate-300" />
                  </button>
                  <button
                    onClick={() => onTabChange('analysis')}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-3.5 py-3 text-left hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2.5">
                      <IconChip tone="blue" size={30} icon={<BarChart3 size={14} />} />
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-700 dark:text-[#d2dbd5]">View Supplier Analysis</span>
                        <span className="block text-[11.5px] text-slate-400 dark:text-[#77857c]">Spend, volume, and trend over time</span>
                      </span>
                    </span>
                    <ChevronRight size={16} className="text-slate-300" />
                  </button>
                  <button
                    onClick={() => onEdit(supplier)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-3.5 py-3 text-left hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2.5">
                      <IconChip tone="amber" size={30} icon={<Pencil size={14} />} />
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-700 dark:text-[#d2dbd5]">Edit Supplier</span>
                        <span className="block text-[11.5px] text-slate-400 dark:text-[#77857c]">Update contact details or status</span>
                      </span>
                    </span>
                    <ChevronRight size={16} className="text-slate-300" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <>
              {!history ? (
                <FullPageSpinner />
              ) : history.length === 0 ? (
                <EmptyState title="No purchases from this supplier yet." />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <Th>Reference</Th>
                      <Th>Date</Th>
                      <Th className="text-right">Total</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {history.map((p) => (
                      <Tr key={p.id}>
                        <Td className="font-medium text-slate-800 dark:text-[#eef3ef]">{p.reference_number}</Td>
                        <Td>{formatDate(p.purchase_date)}</Td>
                        <Td className="text-right">{tzs(p.total_cost)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          )}

          {tab === 'analysis' && (
            <>
              {!history ? (
                <FullPageSpinner />
              ) : history.length === 0 ? (
                <EmptyState title="No purchase history to analyze yet." />
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] p-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Total Spent</p>
                      <p className="mt-1 text-lg font-bold text-slate-800 dark:text-[#eef3ef]">{tzs(totalSpent)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] p-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Purchases</p>
                      <p className="mt-1 text-lg font-bold text-slate-800 dark:text-[#eef3ef]">{purchaseCount}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] p-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Avg. Order Value</p>
                      <p className="mt-1 text-lg font-bold text-slate-800 dark:text-[#eef3ef]">{tzs(avgOrder)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 dark:border-[rgba(255,255,255,0.08)] p-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Last Purchase</p>
                      <p className="mt-1 text-lg font-bold text-slate-800 dark:text-[#eef3ef]">{lastPurchase ? formatDate(lastPurchase.purchase_date) : '—'}</p>
                    </div>
                  </div>

                  {shareOfThisMonth !== null && (
                    <div className="rounded-xl bg-blue-50 px-3.5 py-2.5 text-[12.5px] text-slate-700 dark:text-[#d2dbd5]">
                      {shareOfThisMonth > 0
                        ? `Made up ${shareOfThisMonth.toFixed(0)}% of this month's total purchase spend.`
                        : "No purchases from this supplier yet this month."}
                    </div>
                  )}

                  {months.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-[#77857c]">Spend by Month</p>
                      <div className="space-y-2">
                        {months.map(([key, value]) => (
                          <div key={key}>
                            <div className="mb-1 flex items-center justify-between text-[12px] text-slate-500 dark:text-[#97a49b]">
                              <span>{monthLabel(key)}</span>
                              <span className="font-medium text-slate-700 dark:text-[#d2dbd5]">{tzs(value)}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#0e1512]">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${maxMonth > 0 ? (value / maxMonth) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Create/Edit modal — one form for both, since editing an existing
// supplier's own details (2026-09-11) is otherwise identical to creating
// one, just pre-filled and hitting PATCH instead of POST.
// ---------------------------------------------------------------------------
function SupplierFormModal({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: Supplier | null;
  onSaved: (s: Supplier) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setPhone(editing?.phone ?? '');
      setAddress(editing?.address ?? '');
      setNotes(editing?.notes ?? '');
      setStatus(editing?.status ?? 'active');
    }
  }, [open, editing]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (phone.trim() && !isValidTzPhone(phone)) {
      toast.error(TZ_PHONE_ERROR);
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const res = await suppliersApi.update(editing.id, {
          name: name.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
          status,
        });
        toast.success('Supplier updated.');
        onSaved(res.data);
      } else {
        const res = await suppliersApi.create({
          name: name.trim(),
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        toast.success('Supplier added.');
        onSaved(res.data);
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, editing ? 'Could not update this supplier.' : 'Could not create supplier.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New Supplier'} size="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Phone" hint={TZ_PHONE_HINT}>
          <Input
            placeholder={TZ_PHONE_PLACEHOLDER}
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
          />
        </FormField>
        <FormField label="Location">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </FormField>
        <FormField label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        {editing && (
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </FormField>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : 'Create Supplier'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
