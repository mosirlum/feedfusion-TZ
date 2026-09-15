import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Receipt as ReceiptIcon,
  Search,
  Download,
  Home,
  Zap,
  Wifi,
  FileText,
  ShieldCheck,
  Landmark,
  Briefcase,
  Receipt,
  Package,
  Tag,
  TrendingDown,
  TrendingUp,
  Calendar,
  Coins,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { expensesApi, apiErrorMessage } from '../lib/api';
import { Expense, ExpenseType } from '../types';
import { tzs, formatDate, formatTime, todayIso, isoDaysAgo, initials, pageWindow } from '../lib/format';
import { downloadCsv } from '../lib/exportCsv';
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
  StatCard,
  Table,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';

/**
 * Expenses page redesign (2026-09-12, CLAUDE.md #40) — from the owner's own
 * reference mockup, plus a categorization scheme the owner described in
 * chat rather than in the screenshot: Monthly expenses get a fixed starter
 * list (Rent, Electricity, Wifi/Internet, Stationery, Security), Periodic
 * expenses get their own (Tax, Business Services, Levy), and both end in an
 * "Other" option that reveals a free-text box for a custom category name.
 * "After being added they will be in the list" is implemented by learning
 * from history, not a new table: any custom category already used for a
 * type is merged into that type's dropdown from the already-fetched
 * expense list, ahead of "Other" — no schema change, no new endpoint.
 *
 * `PER_PURCHASE` (incidental cash costs on a delivery that are NOT on the
 * supplier's invoice — kept deliberately separate from `MONTHLY`/
 * `PERIODIC` since migration 009, CLAUDE.md #11) was not part of what the
 * owner described here, so it deliberately keeps a plain free-text category
 * field rather than inventing a fixed list for it.
 *
 * Two things the mockup showed that were deliberately dropped:
 *  - **The row-level "⋮" actions menu** — this page's own footer note (and
 *    `expenses.service.ts`'s design) says expenses "cannot be edited (only
 *    added)," and there is no delete endpoint either, so a menu here would
 *    open to nothing — same reasoning as dropping Stock Adjustments' and
 *    Cash Control's dead-end chevrons (CLAUDE.md #38/#39).
 *  - **The mockup's own default date range** ("today and yesterday" in the
 *    screenshot) — replaced with a real, useful default (last 30 days),
 *    matching every other date-ranged report in this app.
 *
 * "Export" is new and real — a client-side CSV of whatever rows the
 * current filters show, no backend endpoint needed.
 */

type FixedCategoryMap = Record<ExpenseType, string[]>;
const FIXED_CATEGORIES: FixedCategoryMap = {
  MONTHLY: ['Rent', 'Electricity', 'Wifi/Internet', 'Stationery', 'Security'],
  PERIODIC: ['Tax', 'Business Services', 'Levy'],
  PER_PURCHASE: [],
};

const EXPENSE_TYPE_OPTIONS: Array<{ value: ExpenseType; label: string; hint: string }> = [
  { value: 'MONTHLY', label: 'Monthly / recurring', hint: 'A roughly fixed cost that repeats every month — rent, wages, subscriptions.' },
  { value: 'PERIODIC', label: 'Periodic / one-off', hint: 'An occasional, irregular cost — repairs, licence renewals, one-time purchases.' },
  {
    value: 'PER_PURCHASE',
    label: 'Per purchase / delivery',
    hint: "An incidental cost tied to a specific delivery that is NOT already on the supplier's invoice (e.g. loading labor paid to the truck crew). If this cost IS on the supplier's invoice — like most transport/freight — enter it as \"Additional costs\" on the Purchase itself instead, so it's counted once in stock value, not twice here.",
  },
];

const TYPE_TONE: Record<ExpenseType, 'blue' | 'green' | 'amber'> = {
  MONTHLY: 'blue',
  PERIODIC: 'amber',
  PER_PURCHASE: 'green',
};
const TYPE_LABEL: Record<ExpenseType, string> = {
  MONTHLY: 'Monthly',
  PERIODIC: 'Periodic',
  PER_PURCHASE: 'Per Purchase',
};

const CATEGORY_ICONS: Record<string, { icon: typeof Home; tone: 'green' | 'blue' | 'amber' | 'red' | 'slate' }> = {
  Rent: { icon: Home, tone: 'blue' },
  Electricity: { icon: Zap, tone: 'amber' },
  'Wifi/Internet': { icon: Wifi, tone: 'green' },
  Stationery: { icon: FileText, tone: 'slate' },
  Security: { icon: ShieldCheck, tone: 'red' },
  Tax: { icon: Landmark, tone: 'slate' },
  'Business Services': { icon: Briefcase, tone: 'blue' },
  Levy: { icon: Receipt, tone: 'amber' },
  Other: { icon: Package, tone: 'slate' },
};
const FALLBACK_TONES: Array<'green' | 'blue' | 'amber' | 'red' | 'slate'> = ['green', 'blue', 'amber', 'red', 'slate'];

function categoryStyle(category: string) {
  const known = CATEGORY_ICONS[category];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) | 0;
  return { icon: Tag, tone: FALLBACK_TONES[Math.abs(hash) % FALLBACK_TONES.length] };
}

const PAGE_SIZE = 8;

export default function ExpensesPage() {
  const toast = useToast();

  // --- Add New Expense form ---
  const [expenseType, setExpenseType] = useState<ExpenseType>('PERIODIC');
  const [category, setCategory] = useState<string>(FIXED_CATEGORIES.PERIODIC[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    expensesApi
      .list({})
      .then((res) => setExpenses(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load expenses.')))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Learned categories: anything typed via "Other" for a type shows up in
  // that type's own dropdown from then on, sourced from history — no new
  // table, matches "after being added they will be in the list."
  const learnedCategories = useMemo(() => {
    const byType: Record<ExpenseType, string[]> = { MONTHLY: [], PERIODIC: [], PER_PURCHASE: [] };
    const seen: Record<ExpenseType, Set<string>> = { MONTHLY: new Set(), PERIODIC: new Set(), PER_PURCHASE: new Set() };
    for (const e of expenses) {
      const fixed = FIXED_CATEGORIES[e.expense_type];
      if (fixed.includes(e.category) || e.category === 'Other') continue;
      if (!seen[e.expense_type].has(e.category)) {
        seen[e.expense_type].add(e.category);
        byType[e.expense_type].push(e.category);
      }
    }
    return byType;
  }, [expenses]);

  const categoryOptions = [...FIXED_CATEGORIES[expenseType], ...learnedCategories[expenseType], 'Other'];

  function handleTypeChange(t: ExpenseType) {
    setExpenseType(t);
    setCustomCategory('');
    setCategory(FIXED_CATEGORIES[t][0] ?? 'Other');
  }

  const activeHint = EXPENSE_TYPE_OPTIONS.find((o) => o.value === expenseType)?.hint;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const finalCategory = category === 'Other' ? customCategory.trim() : category;
    if (!finalCategory) {
      toast.error(category === 'Other' ? 'Type a name for the custom category.' : 'Choose a category.');
      return;
    }
    setSubmitting(true);
    try {
      await expensesApi.create({
        category: finalCategory,
        amount: Number(amount),
        description: description.trim() || undefined,
        expenseDate,
        expenseType,
      });
      toast.success('Expense recorded.');
      setAmount('');
      setDescription('');
      setCustomCategory('');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not record this expense.'));
    } finally {
      setSubmitting(false);
    }
  }

  // --- Filters ---
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<ExpenseType | 'ALL'>('ALL');
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(30));
  const [dateTo, setDateTo] = useState(todayIso());
  const [page, setPage] = useState(1);

  const allCategories = useMemo(() => Array.from(new Set(expenses.map((e) => e.category))).sort(), [expenses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    return expenses.filter((e) => {
      const d = new Date(e.expense_date);
      if (d < from || d > to) return false;
      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
      if (typeFilter !== 'ALL' && e.expense_type !== typeFilter) return false;
      if (q && !e.category.toLowerCase().includes(q) && !(e.description ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [expenses, search, categoryFilter, typeFilter, dateFrom, dateTo]);

  useEffect(() => setPage(1), [search, categoryFilter, typeFilter, dateFrom, dateTo]);

  const filteredTotal = filtered.reduce((sum, e) => sum + Number(e.amount), 0);
  const avgAmount = filtered.length > 0 ? filteredTotal / filtered.length : 0;
  const topCategory = useMemo(() => {
    if (filtered.length === 0) return null;
    const totals = new Map<string, number>();
    for (const e of filtered) totals.set(e.category, (totals.get(e.category) ?? 0) + Number(e.amount));
    let best: { category: string; total: number } | null = null;
    for (const [cat, total] of totals) {
      if (!best || total > best.total) best = { category: cat, total };
    }
    return best ? { ...best, pct: (best.total / filteredTotal) * 100 } : null;
  }, [filtered, filteredTotal]);

  const monthTrend = useMemo(() => {
    const now = new Date();
    const startThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endLast = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    let thisMonth = 0;
    let lastMonth = 0;
    for (const e of expenses) {
      const d = new Date(e.expense_date);
      if (d >= startThis && d <= now) thisMonth += Number(e.amount);
      else if (d >= startLast && d <= endLast) lastMonth += Number(e.amount);
    }
    return { thisMonth, lastMonth };
  }, [expenses]);
  const monthHint =
    monthTrend.thisMonth === 0 && monthTrend.lastMonth === 0
      ? 'No expenses yet this month'
      : monthTrend.lastMonth === 0
      ? 'No data for last month'
      : (() => {
          const pct = Math.round(((monthTrend.thisMonth - monthTrend.lastMonth) / monthTrend.lastMonth) * 100);
          return `${pct > 0 ? '+' : ''}${pct}% vs last month`;
        })();
  const monthTrendIsIncrease = monthTrend.lastMonth > 0 && monthTrend.thisMonth > monthTrend.lastMonth;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function exportCsv() {
    downloadCsv(
      `expenses-${dateFrom}-to-${dateTo}.csv`,
      ['Date', 'Category', 'Type', 'Description', 'Amount (TZS)', 'Added By'],
      filtered.map((e) => [
        formatDate(e.expense_date),
        e.category,
        TYPE_LABEL[e.expense_type],
        e.description ?? '',
        e.amount,
        e.created_by_name ?? '',
      ])
    );
  }

  return (
    <div>
      <PageHeader icon={<ReceiptIcon size={20} />} title="Expenses" subtitle="General operating costs — kept separate from inventory cost (Section 24)." />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="This Month's Expenses"
          value={tzs(monthTrend.thisMonth)}
          icon={monthTrendIsIncrease ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          tone="green"
          hint={monthHint}
        />
        <StatCard label="Total Records" value={filtered.length} icon={<Calendar size={18} />} tone="blue" hint="In selected filters" />
        <StatCard label="Average Amount" value={tzs(avgAmount)} icon={<Coins size={18} />} tone="amber" hint="Per expense, in selected filters" />
        <StatCard
          label="Top Category"
          value={topCategory ? topCategory.category : '—'}
          icon={<Tag size={18} />}
          tone="purple"
          hint={topCategory ? `${topCategory.pct.toFixed(0)}% of filtered total` : 'No expenses in range'}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit">
          <div className="p-5">
            <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-800 dark:text-[#eef3ef]">
              <IconChip tone="green" size={28} icon={<ReceiptIcon size={14} />} />
              Add New Expense
            </h3>
            <p className="mb-4 text-xs text-slate-400 dark:text-[#77857c]">Record a new business expense.</p>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Type</label>
                <Select value={expenseType} onChange={(e) => handleTypeChange(e.target.value as ExpenseType)}>
                  {EXPENSE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                {activeHint && <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{activeHint}</p>}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Category</label>
                {categoryOptions.length > 1 ? (
                  <>
                    <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                    {category === 'Other' && (
                      <Input
                        className="mt-2"
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        placeholder="Type a category name..."
                        required
                      />
                    )}
                  </>
                ) : (
                  <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Loading labour" required />
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Amount (TZS)</label>
                <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Date</label>
                <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} max={todayIso()} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Description</label>
                <Textarea
                  rows={2}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                  placeholder="e.g. Electricity bill for December, generator fuel, etc."
                />
                <p className="mt-1 text-right text-xs text-slate-400 dark:text-[#77857c]">{description.length}/500</p>
              </div>

              <Button type="submit" className="w-full" loading={submitting} icon={<Plus size={15} />}>
                Save Expense
              </Button>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:text-[#77857c]">
                All expenses are recorded immediately and cannot be edited (only added).
              </p>
            </form>
          </div>
        </Card>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-[#eef3ef]">Expense History</h3>
              <p className="text-xs text-slate-400 dark:text-[#77857c]">View and manage all recorded expenses.</p>
            </div>
            <Button type="button" variant="outline" size="sm" icon={<Download size={14} />} onClick={exportCsv}>
              Export
            </Button>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search expenses..." className="pl-9" />
            </div>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="ALL">All Categories</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ExpenseType | 'ALL')}>
              <option value="ALL">All Types</option>
              {EXPENSE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {TYPE_LABEL[o.value]}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={dateTo} />
              <span className="text-xs text-slate-400 dark:text-[#77857c]">to</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} min={dateFrom} max={todayIso()} />
            </div>
          </div>

          <Card>
            {loading ? (
              <FullPageSpinner />
            ) : filtered.length === 0 ? (
              <EmptyState title="No expenses match these filters." />
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Category</Th>
                      <Th>Type</Th>
                      <Th>Description</Th>
                      <Th className="text-right">Amount (TZS)</Th>
                      <Th>Added By</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {pageItems.map((e) => {
                      const { icon: CatIcon, tone } = categoryStyle(e.category);
                      return (
                        <Tr key={e.id}>
                          <Td>{formatDate(e.expense_date)}</Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <IconChip tone={tone} size={26} icon={<CatIcon size={13} />} />
                              <span className="font-medium text-slate-800 dark:text-[#eef3ef]">{e.category}</span>
                            </div>
                          </Td>
                          <Td>
                            <Badge tone={TYPE_TONE[e.expense_type]}>{TYPE_LABEL[e.expense_type]}</Badge>
                          </Td>
                          <Td className="max-w-xs truncate text-slate-500 dark:text-[#97a49b]">{e.description ?? '—'}</Td>
                          <Td className="text-right font-semibold text-slate-800 dark:text-[#eef3ef]">{tzs(e.amount)}</Td>
                          <Td>
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">
                                {initials(e.created_by_name ?? '?')}
                              </div>
                              <div>
                                <p className="text-slate-700 dark:text-[#d2dbd5]">{e.created_by_name}</p>
                                <p className="text-xs text-slate-400 dark:text-[#77857c]">{formatTime(e.created_at)}</p>
                              </div>
                            </div>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-[rgba(255,255,255,0.08)] px-5 py-3">
                  <p className="text-xs text-slate-400 dark:text-[#77857c]">
                    Showing {pageItems.length} of {filtered.length} expenses
                  </p>
                  <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 dark:text-[#77857c]">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    {pageWindow(page, totalPages).map((n, i) =>
                      n === 'gap' ? (
                        <span key={`gap-${i}`} className="px-1 text-xs text-slate-300">
                          …
                        </span>
                      ) : (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setPage(n)}
                          className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium ${
                            n === page ? 'bg-green-600 text-white' : 'text-slate-600 dark:text-[#b6c2ba] hover:bg-slate-50'
                          }`}
                        >
                          {n}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] text-slate-500 dark:text-[#97a49b] hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
