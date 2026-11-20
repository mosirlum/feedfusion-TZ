import { CSSProperties, MutableRefObject, useEffect, useRef } from 'react';
import { CONFIG } from './loginConfig';

// The living background: the farm photo plus layers that move on top of it.
// Everything is positioned in percent of the photo ("stage"), so it stays
// glued to the picture at every screen size. The only things that change
// with the day/night progress are CSS (see login.css); the canvas draws the
// stars and fireflies.
//
// Swapping the picture: replace frontend/public/login-scene.jpg with another
// 1672x941 image. The hen/chick/corn/sun/lamp positions below are measured
// on THIS picture, so a different picture needs those numbers re-measured.
// The hens and chicks are deliberately NOT animated: they stay part of the photo.
const SRC = '/login-scene.jpg';
const IMG_W = 1672;
const IMG_H = 941;

type Part = { x: number; y: number; w: number; h: number };
const CORN: Part = { x: 790, y: 306, w: 882, h: 114 };

// A box that shows exactly the same pixels as the photo underneath, so it can be moved without a seam.
function slice(p: Part): CSSProperties {
  return {
    left: `${(p.x / IMG_W) * 100}%`,
    top: `${(p.y / IMG_H) * 100}%`,
    width: `${(p.w / IMG_W) * 100}%`,
    height: `${(p.h / IMG_H) * 100}%`,
    backgroundImage: `url(${SRC})`,
    backgroundSize: `${(IMG_W / p.w) * 100}% ${(IMG_H / p.h) * 100}%`,
    backgroundPosition: `${(p.x / (IMG_W - p.w)) * 100}% ${(p.y / (IMG_H - p.h)) * 100}%`,
  };
}

const LAMPS = [
  { x: 33, y: 33, s: 7 },
  { x: 41.5, y: 32, s: 6.5 },
  { x: 49.5, y: 33.5, s: 6.5 },
  { x: 56.2, y: 18.4, s: 4.5 },
  { x: 63.8, y: 19.6, s: 4.5 },
];

// Where the sky is, so stars never land on the roof, silos or trees (fractions of the picture).
function skyTop(x: number): number {
  if (x < 0.299) return 0.26 - 0.117 * (x / 0.299);
  if (x < 0.508) return 0.143 + 0.135 * ((x - 0.299) / 0.209);
  if (x < 0.52) return 0.3;
  if (x < 0.6) return 0.18;
  if (x < 0.676) return 0.19;
  if (x < 0.77) return 0.31;
  if (x < 0.99) return 0.15;
  return 0.29;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function LoginScene({ pRef }: { pRef: MutableRefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const rand = rng(7);

    const stars: { x: number; y: number; r: number; a: number; sp: number; ph: number }[] = [];
    for (let guard = 0; stars.length < CONFIG.STAR_COUNT && guard < 5000; guard++) {
      const x = rand();
      const y = rand() * 0.34;
      if (y > skyTop(x) - 0.012) continue;
      stars.push({ x, y, r: 0.6 + rand() * 1.1, a: 0.5 + rand() * 0.5, sp: 0.8 + rand() * 2.2, ph: rand() * 6.28 });
    }
    const flies = Array.from({ length: CONFIG.FIREFLY_COUNT }, () => ({
      x: 0.46 + rand() * 0.52,
      y: 0.37 + rand() * 0.23,
      dx: 0.01 + rand() * 0.03,
      dy: 0.008 + rand() * 0.02,
      sx: 0.15 + rand() * 0.35,
      sy: 0.2 + rand() * 0.4,
      ph: rand() * 6.28,
      sp: 0.6 + rand() * 1.2,
    }));

    let raf = 0;
    let timer = 0;
    let alive = true;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      const d = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * d));
      cv.height = Math.max(1, Math.round(r.height * d));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const draw = (ts: number) => {
      if (!alive) return;
      const p = pRef.current;
      const W = cv.width;
      const H = cv.height;
      ctx.clearRect(0, 0, W, H);
      if (p < 0.03) {
        timer = window.setTimeout(() => (raf = requestAnimationFrame(draw)), 400); // nothing to draw by day
        return;
      }
      const t = ts / 1000;
      const unit = W / 1672;
      const sv = clamp((p - 0.5) * 3);
      for (const s of stars) {
        const tw = reduced ? 1 : 0.55 + 0.45 * Math.sin(t * s.sp + s.ph);
        ctx.fillStyle = `rgba(255,255,255,${(s.a * tw * sv).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r * unit * 1.4, 0, 6.2832);
        ctx.fill();
      }
      const fv = reduced ? 0 : clamp((p - 0.68) * 3.5);
      if (fv > 0) {
        for (const f of flies) {
          const x = (f.x + Math.sin(t * f.sx + f.ph) * f.dx) * W;
          const y = (f.y + Math.cos(t * f.sy + f.ph * 1.3) * f.dy) * H;
          const a = fv * (0.35 + 0.65 * Math.max(0, Math.sin(t * f.sp + f.ph)));
          const r = 9 * unit * 1.6;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(255,244,160,${a.toFixed(3)})`);
          g.addColorStop(0.35, `rgba(255,230,120,${(a * 0.45).toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,230,120,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 6.2832);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [pRef]);

  return (
    <div className="fl-scene" aria-hidden="true">
      {/* 1. the photo and the things that live in it */}
      <div className="fl-stage">
        <img className="fl-photo" src={SRC} alt="" fetchPriority="high" decoding="async" draggable={false} />
        <div className="fl-sway" style={slice(CORN)} />
        <div className="fl-clouds">
          <i style={{ left: '6%', top: '3%', width: '26%', height: '10%' }} />
          <i style={{ left: '34%', top: '1%', width: '22%', height: '8%' }} />
          <i style={{ left: '60%', top: '8%', width: '24%', height: '9%' }} />
        </div>
        <div className="fl-sunclip">
          <div className="fl-sun">
            <b className="fl-rays" />
            <b className="fl-glow" />
            <b className="fl-disc" />
          </div>
        </div>
      </div>

      {/* 2. sky colour and darkness */}
      <div className="fl-tint fl-warm" />
      <div className="fl-tint fl-purple" />
      <div className="fl-tint fl-night" />

      {/* 3. things that glow at night */}
      <div className="fl-stage">
        <div className="fl-spot" />
        {LAMPS.map((l, i) => (
          <b key={i} className="fl-lamp" style={{ left: `${l.x}%`, top: `${l.y}%`, width: `${l.s}%`, ['--d' as string]: `${i * 0.7}s` } as CSSProperties} />
        ))}
        <b className="fl-moon" />
        <b className="fl-moonref" />
        <canvas ref={canvasRef} className="fl-fx" />
      </div>
    </div>
  );
}
