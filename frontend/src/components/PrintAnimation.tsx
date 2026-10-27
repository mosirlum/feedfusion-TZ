import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { ReceiptDocument, type ReceiptData } from './ReceiptView';

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
 * Sequence: 'printing' (paper feeds out) → 'done' (stamp lands, the finished
 * invoice stays on screen with Cancel / Print buttons under it). Nothing prints
 * by itself: **Print** calls `window.print()` (the finished paper stays behind
 * the browser's dialog and is removed once the dialog closes); **Cancel** (or
 * Esc) removes the overlay. This is what the owner asked for ("it ends here,
 * then I press Print for real"). The overlay is `no-print`, portalled outside
 * every `.print-area*` and its invoice copy has no print hooks, so print.css
 * hides it: it can never end up on the paper (checked with a print-media PDF
 * in the dev harness). Under `prefers-reduced-motion` the feed is ~0.25s and
 * the paper just appears.
 */

const FEED_MS = 2400;
const REDUCED_FEED_MS = 250;

export type PrintPhase = 'idle' | 'printing' | 'done';

export function usePrintAnimation(): {
  startPrint: (data?: ReceiptData | null) => void;
  confirmPrint: () => void;
  cancelPrint: () => void;
  phase: PrintPhase;
  data: ReceiptData | null;
  isPrinting: boolean;
} {
  const [phase, setPhase] = useState<PrintPhase>('idle');
  const [data, setData] = useState<ReceiptData | null>(null);
  const timer = useRef<number | null>(null);
  const running = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  // If the page/modal unmounts mid-animation, just stop; never print for
  // something the person has navigated away from.
  useEffect(
    () => () => {
      clearTimer();
      running.current = false;
    },
    []
  );

  const startPrint = useCallback((next?: ReceiptData | null) => {
    if (running.current) return; // ignore double-clicks
    running.current = true;
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setData(next ?? null);
    setPhase('printing');
    timer.current = window.setTimeout(() => setPhase('done'), reduced ? REDUCED_FEED_MS : FEED_MS);
  }, []);

  const cancelPrint = useCallback(() => {
    clearTimer();
    running.current = false;
    setPhase('idle');
  }, []);

  // Only valid once the paper is out ('done'). Two frames first so the stamped
  // paper is painted before the dialog; the overlay stays behind the dialog and
  // is removed when window.print() returns (Chrome/Edge block until the dialog
  // closes; a browser that returns at once simply removes it straight away).
  const confirmPrint = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          window.print();
        } finally {
          running.current = false;
          setPhase('idle');
        }
      })
    );
  }, []);

  return { startPrint, confirmPrint, cancelPrint, phase, data, isPrinting: phase !== 'idle' };
}

const PAPER_W = 760; // natural width of ReceiptDocument when not printable

export function PrintOverlay({
  phase,
  data,
  onPrint,
  onCancel,
}: {
  phase: PrintPhase;
  data: ReceiptData | null;
  onPrint: () => void;
  onCancel: () => void;
}): JSX.Element | null {
  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onCancel]);
  if (phase === 'idle') return null;
  return createPortal(
    <div className="no-print fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-[radial-gradient(ellipse_at_center,#0f2a1c_0%,#06130d_70%)]" />
      <Stage phase={phase} data={data} onPrint={onPrint} onCancel={onCancel} />
    </div>,
    document.body
  );
}

function Stage({
  phase,
  data,
  onPrint,
  onCancel,
}: {
  phase: PrintPhase;
  data: ReceiptData | null;
  onPrint: () => void;
  onCancel: () => void;
}) {
  const done = phase === 'done';
  const innerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ scale: number; w: number; h: number }>({ scale: 0.5, w: PAPER_W / 2, h: 0 });

  // The paper is the real invoice (same markup as the receipt modal / print
  // output), drawn at its natural 760px width and scaled to fit the screen —
  // so what comes out of the printer is the document that is then printed.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const natH = el.offsetHeight;
    const availW = Math.min(window.innerWidth - 32, 460);
    const availH = window.innerHeight - 32 - 84 - 64; // printer card + buttons + gaps
    const scale = Math.min(1, availW / PAPER_W, availH / natH);
    setSize({ scale, w: PAPER_W * scale, h: natH * scale });
  }, [data]);

  const unpaid = data && Number(data.balance_due) > 0;
  return (
    <div role="status" aria-live="polite" className="relative animate-fade-in" style={{ width: size.w }}>
      {/* Printer */}
      <div className="relative z-10 rounded-2xl bg-green-800 px-4 pb-4 pt-3.5 text-white shadow-panel">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
            <Printer size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[13px] font-bold leading-tight">
              {data?.invoice_number ?? 'Receipt'}
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

      {/* The real invoice feeding out from under the slot */}
      {data && (
        <div className="relative -mt-0.5 overflow-hidden" style={{ height: size.h || undefined }}>
          <div className="print-paper-out shadow-lg" style={{ width: size.w, height: size.h || undefined }}>
            <div ref={innerRef} style={{ width: PAPER_W, transform: `scale(${size.scale})`, transformOrigin: 'top left' }}>
              <ReceiptDocument data={data} printable={false} />
            </div>
          </div>
          {/* The stamp slams on once the paper is fully out ("pap"). */}
          {done && !unpaid && (
            <span className="print-stamp absolute left-[37%] top-[25%] rounded border-[3px] border-green-700/80 px-2.5 py-0.5 font-display text-[20px] font-extrabold uppercase tracking-widest text-green-700/90">
              Paid
            </span>
          )}
          {done && unpaid && data && (
            <span className="print-stamp absolute left-[37%] top-[25%] rounded border-[3px] border-amber-600/80 bg-white/70 px-2.5 py-0.5 text-center font-display text-[13px] font-extrabold uppercase leading-tight tracking-wider text-amber-700/90">
              Balance due
              <br />
              TZS {Number(data.balance_due).toLocaleString('en-TZ')}
            </span>
          )}
        </div>
      )}

      {/* Actions: nothing prints until Print is pressed */}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 flex-1 rounded-xl border border-white/25 bg-white/5 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onPrint}
          disabled={!done}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-green-800 transition-opacity hover:bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Printer size={16} />
          Print
        </button>
      </div>
    </div>
  );
}
