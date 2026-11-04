import { useEffect, useRef, useState } from 'react';

/** Counts a number up from 0 (first render) or from its previous value (later
 *  changes) with an ease-out curve. Honors reduced-motion by jumping straight
 *  to the target. */
export function useCountUp(target: number, ms = 1500): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(target)) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 4);
      const v = a + (target - a) * eased;
      setValue(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        setValue(target);
        from.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return Math.round(value);
}
