import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Wallet, Camera, Activity, Calendar, Lock, Info } from 'lucide-react';
import { cashCountsApi, apiErrorMessage } from '../lib/api';
import { CashCount, CashControlSummary } from '../types';
import { tzs, formatDate, formatTime, todayIso, initials } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FullPageSpinner,
  IconChip,
  Input,
  PageHeader,
  StatCard,
  Table,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';

type RangeFilter = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL';

function mondayOfThisWeek(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function firstOfThisMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

/**
 * Cash Control Center, redesigned from the owner's own reference mockup
 * (2026-09-12, CLAUDE.md #39) — live variance preview, 4 stat cards, and a
 * richer History table with a time-range filter, matching the visual
 * language already established for the Change Approval Center (#36), Stock
 * Count Center (#37), and Stock Adjustments Center (#38).
 *
 * One schema/behavior fact the mockup's own Quick Tip confirms rather than
 * changes: cash counts have no per-day uniqueness constraint (CLAUDE.md #10)
 * — recounting the same day creates a new historical row instead of
 * replacing the previous one, exactly as the mockup's footer text says.
 *
 * One judgment call: the mockup shows an "Expected Cash" preview and a
 * "Live Variance Preview" while filling out the form, but expected cash is
 * only ever pre-fetched for *today* (`GET /cash-counts/summary`) — there is
 * no endpoint for "expected cash as of an arbitrary past date" and adding
 * one just for this preview seemed like overkill for what's almost always
 * a same-day count. So both previews only render when the selected date is
 * today; picking a past date (to backfill a count) shows "Calculated when
 * submitted" instead of a stale or wrong number. The actual, authoritative
 * expected/difference figures are always computed server-side at submission
 * time regardless of date, exactly as before.
 *
 * No fabricated "pending" status — there's no approval workflow here at all
 * (owner-only, applies immediately). "N pending (today)" on the stat card
 * just means "today doesn't have a cash_counts row yet," derived live, not
 * a stored field. The mockup's row-level ">" chevron was dropped — every
 * other redesign with one opens a detail view with more data behind it, but
 * a cash count row's only fields are already the ones shown in this table.
 */
export default function CashControlPage() {
  const toast = useToast();

  // --- Record Cash Count form ---
  const [countDate, setCountDate] = useState(todayIso());
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [summary, setSummary] = useState<CashControlSummary | null>(null);
  const [history, setHistory] = useState<CashCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('TODAY');

  function loadSummary() {
    cashCountsApi
      .summary()
      .then((res) => setSummary(res.data))
      .catch(() => undefined);
  }

  function loadHistory() {
    setLoading(true);
    const params =
      rangeFilter === 'TODAY'
        ? { from: todayIso(), to: todayIso() }
        : rangeFilter === 'WEEK'
        ? { from: mondayOfThisWeek(), to: todayIso() }
        : rangeFilter === 'MONTH'
        ? { from: firstOfThisMonth(), to: todayIso() }
        : {};
    cashCountsApi
      .list(params)
      .then((res) => setHistory(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load cash count history.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeFilter]);

  const isToday = countDate === todayIso();
  const expectedForPreview = isToday ? summary?.expectedCashToday ?? null : null;
  const variancePreview =
    expectedForPreview != null && actualCash !== '' && Number.isFinite(Number(actualCash))
      ? Number(actualCash) - expectedForPreview
      : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (actualCash === '') {
      toast.error('Enter the actual cash counted.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await cashCountsApi.record({
        countDate,
        actualCash: Number(actualCash),
        notes: notes.trim() || undefined,
      });
      toast.success(
        Number(res.data.difference) === 0
          ? 'Cash matches exactly — no discrepancy.'
          : `Recorded — difference of ${tzs(res.data.difference)}.`
      );
      setActualCash('');
      setNotes('');
      loadSummary();
      loadHistory();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not record this cash count.'));
    } finally {
      setSubmitting(false);
    }
  }

  const latest = summary?.latestCount ?? null;
  const latestIsToday = latest ? latest.count_date === todayIso() : false;
  const latestDiff = latest ? Number(latest.difference) : null;

  const pendingToday = summary?.pendingToday ?? 0;

  return (
    <div>
      <PageHeader
        icon={<Wallet size={20} />}
        title="Cash Control Center"
        subtitle="Reconcile today's till against completed sales automatically."
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Expected Cash Today"
          value={tzs(summary?.expectedCashToday ?? 0)}
          icon={<Wallet size={18} />}
          tone="green"
          hint="From completed sales"
        />
        <StatCard
          label="Actual Count Recorded"
          value={latest ? tzs(latest.actual_cash) : '—'}
          icon={<Camera size={18} />}
          tone="blue"
          hint={
            latest
              ? `Last count: ${latestIsToday ? 'Today' : formatDate(latest.count_date)}, ${formatTime(latest.created_at)}`
              : 'No counts recorded yet'
          }
        />
        <StatCard
          label="Variance"
          value={
            latestDiff != null ? (
              <span className={latestDiff === 0 ? 'text-slate-800 dark:text-[#eef3ef]' : latestDiff < 0 ? 'text-danger-600' : 'text-blue-700'}>
                {latestDiff > 0 ? '+' : ''}
                {tzs(latestDiff)}
              </span>
            ) : (
              '—'
            )
          }
          icon={<Activity size={18} />}
          tone="amber"
          hint={latestDiff == null ? 'No data yet' : latestDiff === 0 ? 'Balanced' : latestDiff < 0 ? 'Shortage' : 'Surplus'}
        />
        <StatCard
          label="Counts This Week"
          value={summary?.countsThisWeek ?? 0}
          icon={<Calendar size={18} />}
          tone="purple"
          hint={pendingToday > 0 ? `${pendingToday} pending (today)` : 'All caught up'}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="h-fit p-5">
          <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-800 dark:text-[#eef3ef]">
            <IconChip tone="green" size={28} icon={<Camera size={14} />} />
            Record Cash Count
          </h3>
          <p className="mb-4 text-xs text-slate-400 dark:text-[#77857c]">Enter the actual cash counted at the end of the day.</p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Date</label>
              <Input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} max={todayIso()} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Actual Cash Counted (TZS) *</label>
              <div className="flex items-center gap-2">
                <span className="flex h-[42px] flex-shrink-0 items-center rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-slate-50 px-3 text-sm font-medium text-slate-500 dark:text-[#97a49b]">
                  TZS
                </span>
                <Input
                  type="number"
                  min={0}
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Expected Cash (TZS)</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[rgba(255,255,255,0.14)] bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500 dark:text-[#97a49b]">
                <Lock size={13} className="flex-shrink-0" />
                {isToday ? tzs(summary?.expectedCashToday ?? 0) : 'Calculated automatically when submitted'}
              </div>
              <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">Calculated automatically from completed sales.</p>
            </div>

            {variancePreview !== null && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Live Variance Preview</label>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
                    variancePreview === 0
                      ? 'bg-slate-100 dark:bg-[#0e1512] text-slate-600 dark:text-[#b6c2ba]'
                      : variancePreview < 0
                      ? 'bg-danger-50 text-danger-600'
                      : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {variancePreview > 0 ? '+' : ''}
                  {tzs(variancePreview)}
                  <Badge tone={variancePreview === 0 ? 'slate' : variancePreview < 0 ? 'red' : 'blue'}>
                    {variancePreview === 0 ? 'Balanced' : variancePreview < 0 ? 'Shortage' : 'Surplus'}
                  </Badge>
                </span>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#d2dbd5]">Notes (optional)</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                placeholder="e.g. Less cash due to small bills, customer returned amount..."
              />
              <p className="mt-1 text-right text-xs text-slate-400 dark:text-[#77857c]">{notes.length}/500</p>
            </div>

            <Button type="submit" className="w-full" loading={submitting} icon={<Camera size={15} />}>
              Record Cash Count
            </Button>
            <p className="flex items-start gap-1.5 text-xs text-slate-400 dark:text-[#77857c]">
              <Info size={13} className="mt-0.5 flex-shrink-0" />
              Voided sales are excluded automatically.
            </p>
          </form>
        </Card>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-[#eef3ef]">Cash Count History</h3>
              <p className="text-xs text-slate-400 dark:text-[#77857c]">View all your cash count records. Only the owner can record cash counts.</p>
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

          <Card>
            {loading ? (
              <FullPageSpinner />
            ) : history.length === 0 ? (
              <EmptyState title="No cash counts in this range." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Date</Th>
                    <Th className="text-right">Expected Cash</Th>
                    <Th className="text-right">Counted Cash</Th>
                    <Th className="text-right">Variance</Th>
                    <Th>Recorded By</Th>
                    <Th>Time</Th>
                    <Th>Notes</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {history.map((h) => {
                    const diff = Number(h.difference);
                    const expected = Number(h.expected_cash);
                    const pct = expected > 0 ? Math.abs((diff / expected) * 100) : diff === 0 ? 0 : null;
                    const status = diff === 0 ? 'Balanced' : diff < 0 ? 'Short' : 'Over';
                    return (
                      <Tr key={h.id}>
                        <Td>{formatDate(h.count_date)}</Td>
                        <Td className="text-right">{tzs(h.expected_cash)}</Td>
                        <Td className="text-right">{tzs(h.actual_cash)}</Td>
                        <Td
                          className={`text-right font-medium ${
                            diff === 0 ? 'text-slate-500 dark:text-[#97a49b]' : diff < 0 ? 'text-danger-600' : 'text-blue-700'
                          }`}
                        >
                          {diff > 0 ? '+' : ''}
                          {tzs(diff)}
                          {pct != null && <div className="text-xs font-normal text-slate-400 dark:text-[#77857c]">({pct.toFixed(2)}%)</div>}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">
                              {initials(h.counted_by_name ?? '?')}
                            </div>
                            {h.counted_by_name}
                          </div>
                        </Td>
                        <Td className="text-slate-500 dark:text-[#97a49b]">{formatTime(h.created_at)}</Td>
                        <Td className="max-w-[160px] truncate text-slate-500 dark:text-[#97a49b]">{h.notes ?? '—'}</Td>
                        <Td>
                          <Badge tone={status === 'Balanced' ? 'green' : status === 'Short' ? 'red' : 'blue'}>{status}</Badge>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-5 bg-green-50/60 p-5">
        <p className="text-sm font-semibold text-green-800">Quick tip</p>
        <p className="mt-1 text-xs text-green-700">
          Every cash count is stored permanently. If you recount on the same day, a new historical record will be created
          instead of replacing the previous one.
        </p>
      </Card>
    </div>
  );
}
