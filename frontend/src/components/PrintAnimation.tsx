import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Printer } from 'lucide-react';
import clsx from 'clsx';

/**
 * Print animation, v2 (2026-10-27, CLAUDE.md #82) — the owner clarified that
 * the animation must be the RECEIPT ITSELF coming out of a printer (v1, #78,
 * was a small pop-up card over the page). So the real receipt now feeds out
 * of a printer slot inside the receipt modal, top to bottom, then the
 * browser's print dialog opens.
 *
 * Usage:
 *   const { startPrint, phase } = usePrintAnimation();
 *   <Button onClick={startPrint}>Print</Button>
 *   <PrintFeed phase={phase}><ReceiptView saleId={id} /></PrintFeed>
 *
 * Sequence: 'printing' (receipt feeds out) → 'done' (tick) → 'idle' (printer
 * and clip removed) → two animation frames later `window.print()`. The real
 * receipt element is the one that is revealed (not a clone), and every
 * animation class is gone before the dialog opens, so the printed paper is
 * unaffected (`.print-area-modal` rules in index.css never see a clip-path).
 * Under `prefers-reduced-motion` the sequence is shortened and the receipt
 * simply appears (see index.css).
 */

const FEED_MS = 1600;
const DONE_MS = 450;
const REDUCED_FEED_MS = 250;
const REDUCED_DONE_MS = 250;

export type PrintPhase = 'idle' | 'printing' | 'done';

export function usePrintAnimation(): { startPrint: () => void; phase: PrintPhase; isPrinting: boolean } {
  const [phase, setPhase] = useState<PrintPhase>('idle');
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

  const startPrint = useCallback(() => {
    if (running.current) return; // ignore double-clicks
    running.current = true;
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const feed = reduced ? REDUCED_FEED_MS : FEED_MS;
    const done = reduced ? REDUCED_DONE_MS : DONE_MS;

    setPhase('printing');
    timers.current.push(window.setTimeout(() => setPhase('done'), feed));
    timers.current.push(
      window.setTimeout(() => {
        setPhase('idle');
        // Let React drop the printer/clip and the browser paint once before
        // the (blocking) print dialog opens.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            running.current = false;
            window.print();
          })
        );
      }, feed + done)
    );
  }, []);

  return { startPrint, phase, isPrinting: phase !== 'idle' };
}

/**
 * Wraps the receipt. While printing, shows a printer bar above it and reveals
 * the receipt from the printer slot downwards. Idle = renders children as-is.
 */
export function PrintFeed({ phase, children }: { phase: PrintPhase; children: ReactNode }) {
  const active = phase !== 'idle';
  const done = phase === 'done';
  const top = useRef<HTMLDivElement>(null);

  // The receipt is taller than the modal: start at the top so the person
  // sees it come out of the printer rather than the middle of it.
  useEffect(() => {
    if (active) top.current?.scrollIntoView({ block: 'start' });
  }, [active]);

  return (
    <div ref={top}>
      {active && (
        <div
          role="status"
          aria-live="polite"
          className="no-print sticky top-0 z-10 mx-auto mb-0 max-w-3xl"
        >
          <div className="relative mx-auto flex h-14 w-full items-center justify-between rounded-2xl bg-green-700 px-5 shadow-md">
            <div className="flex items-center gap-2 text-white">
              <Printer size={18} />
              <span className="font-display text-sm font-bold">{done ? 'Ready to print' : 'Printing receipt…'}</span>
            </div>
            <div className="flex items-center gap-2">
              {done && (
                <span className="print-anim-pop flex h-6 w-6 items-center justify-center rounded-full bg-white text-green-700">
                  <Check size={14} strokeWidth={3} />
                </span>
              )}
              <span
                className={clsx('h-2.5 w-2.5 rounded-full', done ? 'bg-green-300' : 'print-anim-led bg-amber-300')}
              />
            </div>
            {/* Paper slot the receipt comes out of */}
            <div className="absolute inset-x-6 -bottom-[3px] h-1.5 rounded-full bg-slate-900/80" />
          </div>
        </div>
      )}
      <div className={clsx(active && 'print-feed-paper', active && 'pt-2')}>{children}</div>
    </div>
  );
}
