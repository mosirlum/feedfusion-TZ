import { CSSProperties, useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Stethoscope } from 'lucide-react';
import { reportsApi } from '../lib/api';
import { ProfitDoctorFinding, ProfitDoctorReport } from '../types';
import { tzs } from '../lib/format';
import { Card, Skeleton } from './ui';

/**
 * Profit Doctor (CLAUDE.md #95). The owner makes big sales but keeps little
 * profit and wanted the SYSTEM, which has the numbers, to explain why and say
 * what to do. Every finding comes from the server (profitDoctor.service.ts)
 * with: what is happening, why it matters, what to do, the evidence, and the
 * money at stake. Everything is visible by scrolling (nothing hidden behind
 * buttons).
 */
const dly = (ms: number): CSSProperties => ({ ['--d' as string]: `${ms}ms` });
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`;

const TONE: Record<ProfitDoctorFinding['severity'], { box: string; chip: string; label: string; Icon: typeof AlertTriangle }> = {
  critical: { box: 'border-danger-200 bg-danger-50/60 dark:border-danger-900/60 dark:bg-danger-900/15', chip: 'bg-danger-100 text-danger-700 dark:bg-danger-900/50 dark:text-danger-200', label: 'Fix first', Icon: AlertTriangle },
  warning: { box: 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-900/10', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', label: 'Needs attention', Icon: AlertTriangle },
  info: { box: 'border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-900/10', chip: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200', label: 'Good to know', Icon: Info },
  good: { box: 'border-green-200 bg-green-50/60 dark:border-green-900/50 dark:bg-green-900/10', chip: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200', label: 'All good', Icon: CheckCircle2 },
};

export function ProfitDoctorCard({ from, to, periodLabel }: { from: string; to: string; periodLabel?: string }) {
  const [data, setData] = useState<ProfitDoctorReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    reportsApi
      .profitDoctor(from, to)
      .then((r) => active && setData(r.data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [from, to]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Stethoscope size={17} className="text-green-600 dark:text-green-400" aria-hidden="true" />
        <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Profit Doctor: why is my profit small?</h3>
      </div>
      {periodLabel && <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:bg-[#0e1512] dark:text-[#97a49b]">{periodLabel}</span>}
    </div>
  );

  if (failed) {
    return (
      <Card className="p-5">
        {header}
        <p className="mt-2 text-sm text-slate-500 dark:text-[#97a49b]">Could not load the profit analysis. Refresh the page to try again.</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="p-5">
        {header}
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    );
  }

  const { summary: s, findings, products } = data;
  if (!(s.revenue > 0)) {
    return (
      <Card className="p-5">
        {header}
        <p className="mt-2 text-sm text-slate-500 dark:text-[#97a49b]">No sales in this period yet, so there is nothing to explain.</p>
      </Card>
    );
  }

  const total = Math.max(100, s.per100.products + s.per100.expenses);
  const seg = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  const fixRows = products.filter((p) => p.gain > 0);

  return (
    <Card className="p-5">
      {header}

      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-[#b6c2ba]">
        You sold <b>{tzs(s.revenue)}</b>. Out of every <b>TZS 100</b> sold, <b>TZS {Math.round(s.per100.products)}</b> paid for the products, <b>TZS {Math.round(s.per100.expenses)}</b> went to expenses, and{' '}
        <b className={s.net >= 0 ? 'text-green-700 dark:text-green-300' : 'text-danger-600 dark:text-danger-300'}>{s.net >= 0 ? `TZS ${Math.round(s.per100.profit)} is your profit (${tzs(s.net)})` : `you lost ${Math.abs(s.per100.profit) < 1 ? 'less than TZS 1' : `TZS ${Math.round(Math.abs(s.per100.profit))}`} (${tzs(Math.abs(s.net))})`}</b>.
      </p>
      <div className="mt-3 flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[#0e1512]" role="img" aria-label="Where the sales money went">
        <div className="ff-grow-x h-full bg-slate-400 dark:bg-slate-500" style={{ ...dly(300), width: seg(s.per100.products) }} />
        <div className="ff-grow-x h-full bg-amber-400" style={{ ...dly(500), width: seg(s.per100.expenses) }} />
        {s.net > 0 && <div className="ff-grow-x h-full bg-green-500" style={{ ...dly(700), width: seg(s.per100.profit) }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-[#97a49b]">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />Products {tzs(s.cogs)}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Expenses {tzs(s.expenses)}</span>
        <span><span className={clsx('mr-1 inline-block h-2 w-2 rounded-full', s.net >= 0 ? 'bg-green-500' : 'bg-danger-500')} />{s.net >= 0 ? 'Profit' : 'Loss'} {tzs(Math.abs(s.net))}</span>
        <span>Gross margin {pct(s.grossMarginPct)} (target {data.targetMarginPct}%)</span>
      </div>

      {data.potentialTzs > 0 && (
        <div className="mt-4 rounded-xl bg-green-600 p-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-100">Money you can win back</p>
          <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">About {tzs(data.potentialTzs)} in this period</p>
          <p className="mt-1 text-xs text-green-100">If you fix the points below. {data.assumption}</p>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {findings.map((f, i) => {
          const t = TONE[f.severity];
          return (
            <section key={f.id} className={clsx('ff-rise rounded-xl border p-4', t.box)} style={dly(150 + i * 90)}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <t.Icon size={18} className="mt-0.5 shrink-0 text-slate-600 dark:text-[#b6c2ba]" aria-hidden="true" />
                  <h4 className="min-w-0 font-display font-bold text-slate-800 dark:text-[#eef3ef]">{f.title}</h4>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {f.impactTzs !== null && f.impactTzs > 0 && <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-bold tabular-nums text-slate-700 dark:bg-white/10 dark:text-[#d2dbd5]">≈ {tzs(f.impactTzs)}</span>}
                  <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold', t.chip)}>{t.label}</span>
                </div>
              </div>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">What is happening</dt>
                  <dd className="mt-1 text-slate-700 dark:text-[#d2dbd5]">{f.what}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">Why it matters</dt>
                  <dd className="mt-1 text-slate-700 dark:text-[#d2dbd5]">{f.why}</dd>
                </div>
              </dl>
              <div className="mt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">What to do</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-[#d2dbd5]">
                  {f.actions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ol>
              </div>
              {f.evidence.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-200/70 rounded-lg bg-white/60 px-3 text-sm dark:divide-white/10 dark:bg-black/10">
                  {f.evidence.map((e) => (
                    <li key={e.label + e.value} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
                      <span className="font-semibold text-slate-700 dark:text-[#d2dbd5]">{e.label}</span>
                      <span className="tabular-nums text-slate-600 dark:text-[#b6c2ba]">{e.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {fixRows.length > 0 && (
        <div className="mt-5">
          <h4 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">Prices to correct</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-[#97a49b]">Suggested price = latest buying cost (with transport) + a {data.targetMarginPct}% margin. Change prices in Products → Price Proposals.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">
                  <th className="py-2 pr-3 font-bold">Product</th>
                  <th className="py-2 pr-3 text-right font-bold">Sold at (avg)</th>
                  <th className="py-2 pr-3 text-right font-bold">Cost now</th>
                  <th className="py-2 pr-3 text-right font-bold">Margin</th>
                  <th className="py-2 pr-3 text-right font-bold">Suggested price</th>
                  <th className="py-2 text-right font-bold">Extra profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                {fixRows.map((p) => (
                  <tr key={p.productId}>
                    <td className="py-2 pr-3 font-semibold text-slate-800 dark:text-[#eef3ef]">{p.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{tzs(p.avgPrice)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{tzs(p.costNow)}</td>
                    <td className={clsx('py-2 pr-3 text-right font-bold tabular-nums', p.marginPct < 3 ? 'text-danger-600 dark:text-danger-300' : 'text-amber-600 dark:text-amber-300')}>{pct(p.marginPct)}</td>
                    <td className="py-2 pr-3 text-right font-bold tabular-nums text-green-700 dark:text-green-300">{tzs(p.suggestedPrice)}</td>
                    <td className="py-2 text-right tabular-nums">{tzs(p.gain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
