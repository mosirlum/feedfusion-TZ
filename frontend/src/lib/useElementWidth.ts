import { useEffect, useRef, useState } from 'react';

// Measured width of an element, so hand-rolled SVG charts can draw at the
// real pixel size (keeping axis text readable on a phone) instead of
// scaling a fixed viewBox down. Falls back to `initial` before first
// measure and where ResizeObserver is missing.
export function useElementWidth<T extends HTMLElement = HTMLDivElement>(initial = 640, min = 280) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(min, Math.round(el.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return { ref, width };
}
