import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from './loginConfig';

// One number drives the whole scene: p = 0 is full day, p = 1 is deep night.
// It is animated with requestAnimationFrame and written to the page as the CSS
// variable --p, and every layer in login.css reads that variable. Because
// there is a single progress value, an interrupted sunset simply runs back
// from wherever it is (no jumps).
const smooth = (x: number) => x * x * (3 - 2 * x);
const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The card is hidden once the sunset has gone this far (see --co in login.css).
export const CARD_HIDE_AT = 0.68;

function initialProgress(): number {
  if (!CONFIG.START_FROM_CLOCK) return 0;
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 6 && h < 17) return 0; // day
  if (h >= 17 && h < 19) return 0.22; // golden hour
  return 0.42; // twilight (the sign-in card is still visible)
}

export function useDayNight(rootRef: RefObject<HTMLElement>) {
  const start = initialProgress();
  const lin = useRef(start); // linear progress
  const eased = useRef(smooth(start)); // what the CSS sees
  const target = useRef(start); // hold the starting look until something happens
  const raf = useRef(0);
  const hiddenRef = useRef(eased.current >= CARD_HIDE_AT);
  const fn = useRef({ toggleManual: () => {}, setBusy: (_b: boolean) => {} });

  const [isNight, setIsNight] = useState(false);
  const [manual, setManual] = useState(false);
  const [cardHidden, setCardHidden] = useState(hiddenRef.current);
  const [enterTick, setEnterTick] = useState(1);

  useEffect(() => {
    let idleTimer = 0;
    let focused = false;
    let locked = false; // night was forced with the moon/sun button
    let busy = false; // signing in / welcome message
    let lastWake = 0;

    const paint = () => {
      const e = smooth(lin.current);
      eased.current = e;
      rootRef.current?.style.setProperty('--p', e.toFixed(4));
      const hidden = e >= CARD_HIDE_AT;
      if (hidden !== hiddenRef.current) {
        hiddenRef.current = hidden;
        setCardHidden(hidden);
        if (!hidden) setEnterTick((t) => t + 1); // card is coming back: play the staggered entrance
      }
    };

    const run = () => {
      if (raf.current) return;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const t = target.current;
        let p = lin.current;
        if (p !== t) {
          const dur = prefersReduced() ? 0.5 : t > p ? CONFIG.SUNSET_DURATION : CONFIG.SUNRISE_DURATION;
          const dir = t > p ? 1 : -1;
          p += (dir * dt) / dur;
          if ((dir > 0 && p >= t) || (dir < 0 && p <= t)) p = t;
          lin.current = p;
          paint();
        }
        raf.current = lin.current !== target.current ? requestAnimationFrame(step) : 0;
      };
      raf.current = requestAnimationFrame(step);
    };

    const goNight = () => {
      target.current = 1;
      setIsNight(true);
      run();
    };
    const goDay = () => {
      target.current = 0;
      setIsNight(false);
      run();
    };

    const armIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        // typing in a field, a forced night or a sign-in in progress is never "idle"
        if (locked || focused || busy) return armIdle();
        goNight();
      }, CONFIG.IDLE_SECONDS * 1000);
    };

    const wake = () => {
      const now = Date.now();
      if (now - lastWake < 250) return;
      lastWake = now;
      if (!locked && target.current !== 0) goDay();
      armIdle();
    };

    const onFocusIn = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el && el.matches?.('input,textarea,select')) {
        focused = true;
        lastWake = 0;
        wake();
      }
    };
    const onFocusOut = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el && el.matches?.('input,textarea,select')) {
        focused = false;
        armIdle();
      }
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll', 'pointerdown', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, wake, { passive: true, capture: true }));
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    fn.current = {
      // The moon/sun button: forces night (and stops the idle timer) or brings the day back.
      toggleManual: () => {
        if (target.current >= 0.5) {
          locked = false;
          setManual(false);
          goDay();
          armIdle();
        } else {
          locked = true;
          setManual(true);
          window.clearTimeout(idleTimer);
          goNight();
        }
      },
      setBusy: (b: boolean) => {
        busy = b;
        if (b && target.current !== 0 && !locked) goDay();
        if (!b) armIdle();
      },
    };

    paint();
    armIdle();
    return () => {
      window.clearTimeout(idleTimer);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      events.forEach((ev) => window.removeEventListener(ev, wake, { capture: true }));
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [rootRef]);

  const toggleManual = useCallback(() => fn.current.toggleManual(), []);
  const setBusy = useCallback((b: boolean) => fn.current.setBusy(b), []);

  return { pRef: eased, isNight, manual, cardHidden, enterTick, toggleManual, setBusy };
}
