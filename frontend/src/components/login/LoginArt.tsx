// Brand artwork for the login page: the three-circle logo (paw, fish, leaf),
// the small icons and the green/blue corner shapes. Drawn as SVG so they stay
// sharp at every size.
import type { CSSProperties } from 'react';

export function Paw({ size }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <ellipse cx="5.2" cy="10.2" rx="2.1" ry="2.7" />
      <ellipse cx="9.3" cy="5.9" rx="2.1" ry="2.9" />
      <ellipse cx="15.1" cy="5.9" rx="2.1" ry="2.9" />
      <ellipse cx="19.2" cy="10.2" rx="2.1" ry="2.7" />
      <path d="M12.2 11.2c-3.3 0-6.2 3.3-6.2 6.2 0 1.9 1.4 2.7 3.2 2.3 1-.2 2-.7 3-.7s2 .5 3 .7c1.8.4 3.2-.4 3.2-2.3 0-2.9-2.9-6.2-6.2-6.2z" />
    </svg>
  );
}

export function Fish({ size }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M2.2 12c2.6-4.6 7.2-6 11.3-4 1.5.7 2.9 1.9 3.9 3.2L22 8v8l-4.6-3.2c-1 1.3-2.4 2.5-3.9 3.2-4.1 2-8.7.6-11.3-4z" />
      <circle cx="7.2" cy="11" r="1.1" style={{ fill: 'var(--eye, #fff)' }} />
    </svg>
  );
}

export function Leaf({ size }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M20.5 3.5C11 3.5 4.5 8.5 4.5 15.5c0 1.8.5 3.3 1.3 4.5.7-3.2 3.1-6.2 7.2-8.7-3.1 2.9-5 5.9-5.8 9 1.2.6 2.6.9 4 .9 5.5 0 9.3-4.8 9.3-10.7 0-2.6-.3-4.6 0-7z" />
    </svg>
  );
}

// "FEED FUSION / TANZANIA" with the three circles above and the swoosh below.
export function LogoMark({ className }: { className?: string }) {
  const ring = { stroke: '#fff', strokeWidth: 3 } as const;
  return (
    <svg className={className} viewBox="0 0 300 160" role="img" aria-label="Feed Fusion Tanzania">
      <defs>
        <linearGradient id="fl-sw" x1="0" x2="1">
          <stop offset="0" stopColor="#2E9B2E" />
          <stop offset="1" stopColor="#0B4FA8" />
        </linearGradient>
      </defs>
      <g style={{ filter: 'drop-shadow(0 2px 3px rgba(11,42,74,.25))' }}>
        <circle cx="67" cy="40" r="36" fill="#2E9B2E" {...ring} />
        <circle cx="150" cy="40" r="36" fill="#0B4FA8" {...ring} />
        <circle cx="233" cy="40" r="36" fill="#2E9B2E" {...ring} />
      </g>
      <g fill="#fff" color="#fff">
        <g transform="translate(43 16) scale(2)"><Paw size={24} /></g>
        <g transform="translate(131 21) scale(1.6)" style={{ ['--eye' as string]: '#0B4FA8' } as CSSProperties}><Fish size={24} /></g>
        <g transform="translate(209 16) scale(2)"><Leaf size={24} /></g>
      </g>
      <text x="150" y="108" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" fontSize="40" fill="#1E7A1E" textLength="288" lengthAdjust="spacingAndGlyphs">FEED FUSION</text>
      <text x="150" y="136" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" fontSize="27" fill="#0B4FA8" textLength="170" lengthAdjust="spacingAndGlyphs">TANZANIA</text>
      <path d="M62 150c60-10 130-6 176-24" fill="none" stroke="url(#fl-sw)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function CornerTopRight() {
  return (
    <svg className="fl-tr" viewBox="0 0 340 130" preserveAspectRatio="xMaxYMin meet" aria-hidden="true">
      <defs>
        <linearGradient id="fl-g1" x1="0" x2="1">
          <stop offset="0" stopColor="#2E9B2E" />
          <stop offset="1" stopColor="#1E7A1E" />
        </linearGradient>
      </defs>
      <path d="M190 0H340V118C318 80 262 28 190 0Z" fill="#0B4FA8" />
      <path d="M0 0H214C268 26 308 62 340 74V96C292 82 236 54 188 26 150 4 86 0 0 0Z" fill="url(#fl-g1)" />
    </svg>
  );
}

export function CornerBottomRight() {
  return (
    <svg className="fl-br" viewBox="0 0 440 74" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
      <path d="M150 74C250 66 350 44 440 6V74Z" fill="#0B4FA8" />
      <path d="M0 74C150 74 300 62 440 22V36C300 74 150 76 0 74Z" fill="#2E9B2E" />
    </svg>
  );
}

// The green bar at the bottom-left with the three small icons and the name.
export function BottomBar() {
  return (
    <div className="fl-bar">
      <svg viewBox="0 0 640 108" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="fl-g2" x1="0" x2="1">
            <stop offset="0" stopColor="#0f5d1f" />
            <stop offset="1" stopColor="#1E7A1E" />
          </linearGradient>
        </defs>
        <path d="M0 8C150 6 300 0 424 44C474 62 524 88 576 108H0Z" fill="#5cc24a" />
        <path d="M0 18C150 16 300 10 420 52C470 70 520 94 560 108H0Z" fill="url(#fl-g2)" />
      </svg>
      <div className="fl-bar-in">
        <span className="fl-bar-ic"><Paw /></span>
        <span className="fl-bar-ic"><Fish /></span>
        <span className="fl-bar-ic"><Leaf /></span>
        <i className="fl-bar-rule" />
        <span className="fl-bar-name">Feed Fusion Tanzania</span>
      </div>
    </div>
  );
}
