import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import clsx from 'clsx';
import { tzs, formatDate } from '../lib/format';
import type { ReceiptData } from './ReceiptView';

/**
 * Print animation, v3 (2026-10-27, CLAUDE.md #84). History: v1 (#78) was a
 * small pop-up; v2 (#82) clipped the receipt inside the modal; the owner then
 * showed a reference of what he meant — a compact printer card in the middle
 * of the screen with the receipt paper feeding out from underneath it, a
 * "Printing your receipt" status that turns to done — so this is that idea,
 * drawn in Feed Fusion's own green style (own artwork, not a copy of anyone's
 * component).
 *
 * Usage:
 *   const { startPrint, phase, info } = usePrintAnimation();
 *   <Button onClick={() => startPrint({ invoiceNumber, total, customer })}>Print</Button>
 *   <PrintOverlay phase={phase} info={info} />
 *
 * Sequence: 'printing' (paper feeds out) → 'done' (status turns green) →
 * 'idle' (overlay removed) → two animation frames later `window.print()`.
 * The overlay is `no-print`, portalled outside every `.print-area*` and gone
 * before the dialog opens, so it can never end up on the paper. Under
 * `prefers-reduced-motion` it is shortened and the paper just appears.
 */

const FEED_MS = 2000;
const DONE_MS = 600;
const REDUCED_FEED_MS = 250;
const REDUCED_DONE_MS = 250;

export type PrintPhase = 'idle' | 'printing' | 'done';

/** What the paper shows. All optional: the animation works with none of it. */
export interface PrintInfo {
  invoiceNumber?: string;
  dateLabel?: string;
  customer?: string | null;
  items?: Array<{ name: string; qty: string; amount: string }>;
  subtotal?: string;
  discount?: string;
  total?: string;
  paid?: boolean;
}

/** Build the paper's content from the real receipt the modal has loaded. */
export function printInfoFromReceipt(d: ReceiptData): PrintInfo {
  return {
    invoiceNumber: d.invoice_number,
    dateLabel: formatDate(d.sale_date),
    customer: d.customer_name_or_walkin,
    items: d.items.map((i) => ({
      name: i.product_name,
      qty: `${i.quantity}${i.unit ? ' ' + i.unit : ''}`,
      amount: tzs(Number(i.line_subtotal) - Number(i.discount_amount || 0)),
    })),
    subtotal: tzs(d.subtotal),
    discount: Number(d.total_discount) > 0 ? tzs(d.total_discount) : undefined,
    total: tzs(d.total),
    paid: d.payment_status === 'PAID',
  };
}

export function usePrintAnimation(): {
  startPrint: (info?: PrintInfo) => void;
  phase: PrintPhase;
  info: PrintInfo;
  isPrinting: boolean;
} {
  const [phase, setPhase] = useState<PrintPhase>('idle');
  const [info, setInfo] = useState<PrintInfo>({});
  const timers = useRef<number[]>([]);
  const running = useRef(false);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // If the page/modal unmounts mid-animation, drop the pending print rather
  // than opening a print dialog for something the person has navigated from.
  useEffect(
    () => () => {
      clearTimers();
      running.current = false;
    },
    []
  );

  const startPrint = useCallback((next?: PrintInfo) => {
    if (running.current) return; // ignore double-clicks
    running.current = true;
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const feed = reduced ? REDUCED_FEED_MS : FEED_MS;
    const done = reduced ? REDUCED_DONE_MS : DONE_MS;

    setInfo(next ?? {});
    setPhase('printing');
    timers.current.push(window.setTimeout(() => setPhase('done'), feed));
    timers.current.push(
      window.setTimeout(() => {
        setPhase('idle');
        // Let React remove the overlay and the browser paint once before the
        // (blocking) print dialog opens.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            running.current = false;
            window.print();
          })
        );
      }, feed + done)
    );
  }, []);

  return { startPrint, phase, info, isPrinting: phase !== 'idle' };
}

/** Deterministic barcode-style bars from a string (decorative, own drawing). */
function bars(seed: string): number[] {
  const digits = (seed.replace(/\D/g, '') || '2026').padEnd(12, '7');
  const out: number[] = [];
  for (let i = 0; i < 30; i++) {
    const d = Number(digits[i % digits.length]) + i;
    out.push(1 + (d % 3));
  }
  return out;
}

export function PrintOverlay({ phase, info }: { phase: PrintPhase; info: PrintInfo }): JSX.Element | null {
  if (phase === 'idle') return null;
  const done = phase === 'done';
  return createPortal(
    <div className="no-print fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/55 backdrop-blur-[2px]" />
      <div role="status" aria-live="polite" className="relative w-72 animate-fade-in">
        {/* Printer */}
        <div className="relative z-10 rounded-2xl bg-green-800 px-4 pb-4 pt-3.5 text-white shadow-panel">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
              <Printer size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[13px] font-bold leading-tight">
                {info.invoiceNumber ?? 'Receipt'}
              </p>
              <p className="truncate text-[11px] leading-tight text-green-100/80">
                {done ? 'Receipt ready' : 'Printing your receipt'}
              </p>
            </div>
            {done ? (
              <span className="print-anim-pop h-3 w-3 rounded-full bg-green-300 shadow-[0_0_0_4px_rgba(134,239,172,0.25)]" />
            ) : (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            )}
          </div>
          {/* Paper slot */}
          <div className="absolute inset-x-5 -bottom-[3px] h-[7px] rounded-full bg-slate-950" />
        </div>

        {/* Paper feeding out from under the slot */}
        <div className="-mt-0.5 overflow-hidden px-6 pb-2">
          <div className="print-paper-out">
            <Paper info={info} />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Paper({ info }: { info: PrintInfo }) {
  const b = bars(info.invoiceNumber ?? '');
  const items = info.items ?? [];
  const shown = items.slice(0, 5);
  const more = items.length - shown.length;
  return (
    <div
      className={clsx(
        'relative bg-white px-4 pb-6 pt-4 text-[#1a1a1a] shadow-lg',
        '[clip-path:polygon(0_0,100%_0,100%_calc(100%-8px),95%_100%,90%_calc(100%-8px),85%_100%,80%_calc(100%-8px),75%_100%,70%_calc(100%-8px),65%_100%,60%_calc(100%-8px),55%_100%,50%_calc(100%-8px),45%_100%,40%_calc(100%-8px),35%_100%,30%_calc(100%-8px),25%_100%,20%_calc(100%-8px),15%_100%,10%_calc(100%-8px),5%_100%,0_calc(100%-8px))]'
      )}
    >
      <p className="text-center font-display text-[11px] font-extrabold uppercase tracking-[0.14em] text-green-800">
        Feed Fusion Tanzania
      </p>
      <p className="mt-0.5 text-center text-[9px] uppercase tracking-widest text-slate-400">Invoice</p>
      <div className="my-2.5 border-t border-dashed border-slate-300" />
      <div className="flex justify-between gap-2 text-[10px] text-slate-500">
        <span className="truncate">{info.customer || 'Walk-in Customer'}</span>
        {info.dateLabel && <span className="shrink-0">{info.dateLabel}</span>}
      </div>
      {info.total && (
        <p className="mt-1 font-display text-[22px] font-extrabold leading-none tabular-nums">{info.total}</p>
      )}
      {info.paid && (
        <span className="absolute right-3 top-9 -rotate-12 rounded border-2 border-green-700/70 px-1.5 py-0.5 font-display text-[11px] font-extrabold uppercase tracking-widest text-green-700/80">
          Paid
        </span>
      )}
      <div className="my-2.5 border-t border-dashed border-slate-300" />
      {shown.length > 0 ? (
        <div className="space-y-1 text-[10px]">
          {shown.map((it, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {it.qty} × {it.name}
              </span>
              <span className="shrink-0 tabular-nums">{it.amount}</span>
            </div>
          ))}
          {more > 0 && <p className="text-slate-400">+ {more} more</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded bg-slate-200" />
          <div className="h-1.5 w-4/5 rounded bg-slate-200" />
          <div className="h-1.5 w-3/5 rounded bg-slate-200" />
        </div>
      )}
      {(info.subtotal || info.discount) && <div className="my-2.5 border-t border-dashed border-slate-300" />}
      <div className="space-y-0.5 text-[10px] text-slate-500">
        {info.subtotal && (
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{info.subtotal}</span>
          </div>
        )}
        {info.discount && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span className="tabular-nums text-red-500">- {info.discount}</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between border-t border-slate-800 pt-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider">Grand total</span>
        <span className="font-display text-[13px] font-extrabold tabular-nums">{info.total ?? '—'}</span>
      </div>
      <div className="mt-3 flex h-8 items-stretch justify-center gap-[2px]">
        {b.map((w, i) => (
          <span key={i} className="bg-slate-800" style={{ width: w }} />
        ))}
      </div>
      <p className="mt-1 text-center font-mono text-[8px] tracking-widest text-slate-400">
        {info.invoiceNumber ?? ''}
      </p>
      <p className="mt-1.5 text-center text-[9px] text-slate-400">Thank you for choosing Feed Fusion Tanzania</p>
    </div>
  );
}
