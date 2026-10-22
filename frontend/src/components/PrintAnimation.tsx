import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import clsx from 'clsx';

/**
 * Print animation (2026-10-22, CLAUDE.md #78) — the owner asked for a short
 * "paper coming out of the printer" animation when Print is pressed on an
 * invoice/receipt, before the browser's print dialog opens.
 *
 * Usage:
 *   const { startPrint, printOverlay } = usePrintAnimation();
 *   <Button onClick={startPrint}>Print</Button>
 *   {printOverlay}
 *
 * Sequence: "printing" (paper feeds out) -> "done" (tick) -> overlay removed ->
 * two animation frames later `window.print()`. The overlay is gone before the
 * dialog opens, so it can never end up on the paper (it is also `no-print`
 * and sits outside every `.print-area*`, which the print CSS already hides).
 * Under `prefers-reduced-motion` the sequence is shortened and the paper
 * simply appears (see index.css).
 */

const FEED_MS = 1100;
const DONE_MS = 500;
const REDUCED_FEED_MS = 250;
const REDUCED_DONE_MS = 250;

type Phase = 'idle' | 'printing' | 'done';

export function usePrintAnimation(): { startPrint: () => void; printOverlay: ReactNode; isPrinting: boolean } {
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);
  const running = useRef(false);

  // If the page/modal unmounts mid-animation, drop the pending print rather
  // than opening a print dialog for something the person has navigated from.
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
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

  const printOverlay = phase === 'idle' ? null : <PrintAnimationOverlay phase={phase} />;
  return { startPrint, printOverlay, isPrinting: phase !== 'idle' };
}

function PrintAnimationOverlay({ phase }: { phase: Exclude<Phase, 'idle'> }) {
  const done = phase === 'done';
  return createPortal(
    <div className="no-print fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-fade-in" />
      <div
        role="status"
        aria-live="polite"
        className="relative flex w-64 flex-col items-center rounded-card bg-white px-6 pb-6 pt-7 shadow-panel animate-fade-in dark:border dark:border-[rgba(255,255,255,0.08)] dark:bg-[#121a16]"
      >
        {/* Printer + paper. The paper sits BEHIND the printer body and slides
            down out of its slot, so only the part past the body is visible. */}
        <div className="relative h-[142px] w-40">
          <div className="print-anim-paper absolute left-1/2 top-[-28px] z-0 -ml-[52px] h-[92px] w-[104px] rounded-b-[3px] border border-slate-200 bg-white px-3 pt-8 shadow-sm dark:border-[#2a3a31] dark:bg-[#f4f7f5]">
            <div className="mb-2 h-1.5 w-1/2 rounded bg-green-600" />
            <div className="mb-1.5 h-1 w-full rounded bg-slate-200" />
            <div className="mb-1.5 h-1 w-5/6 rounded bg-slate-200" />
            <div className="mb-1.5 h-1 w-2/3 rounded bg-slate-200" />
            <div className="mt-3 flex justify-between">
              <div className="h-1.5 w-8 rounded bg-slate-300" />
              <div className="h-1.5 w-10 rounded bg-green-700" />
            </div>
          </div>

          <div className="relative z-10 h-16 w-40 rounded-2xl bg-green-700 shadow-md">
            <div className="absolute inset-x-4 top-3 h-2 rounded-full bg-green-900/60" />
            <div className="absolute inset-x-6 bottom-0 h-1.5 rounded-t bg-slate-900/70" />
            <div
              className={clsx(
                'absolute right-4 top-[26px] h-2 w-2 rounded-full',
                done ? 'bg-green-300' : 'print-anim-led bg-amber-300'
              )}
            />
          </div>

          {done && (
            <div className="print-anim-pop absolute bottom-3 right-1 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-white shadow-lg ring-4 ring-white dark:ring-[#121a16]">
              <Check size={20} strokeWidth={3} />
            </div>
          )}
        </div>

        <p className="mt-3 font-display text-sm font-bold text-slate-800 dark:text-[#eef3ef]">
          {done ? 'Ready to print' : 'Sending to printer…'}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-[#77857c]">
          {done ? 'Opening the print dialog' : 'Preparing your receipt'}
        </p>
      </div>
    </div>,
    document.body
  );
}
