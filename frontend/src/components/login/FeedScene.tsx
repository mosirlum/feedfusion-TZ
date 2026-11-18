import clsx from 'clsx';

// Login scene for Feed Fusion: a scoop lifts feed out of a sack, pours it
// into a trough and three birds (chick -> bigger chick -> hen, i.e. "feed
// becomes growth") peck at it. Pure SVG + CSS (about 3 KB, no images, no
// video), so it loads instantly on a weak mobile connection. All motion lives
// in index.css under `.ff-scene` and is switched off by prefers-reduced-motion.
//
// `mood` drives the speed of the scene from what the user is doing in the
// form: idle (slow loop), active (they are typing: pecking is faster) and
// pour (the form is being submitted: the scoop works fast). `errorTick`
// increases on every failed sign-in so the birds shake their heads once.
//
// This component is the reusable "scene slot" of the login page: another
// system (perfume, petrol station, furniture, logistics) can ship its own
// scene with the same props and the same form.
export type SceneMood = 'idle' | 'active' | 'pour';

const PELLETS = [
  { i: 0, dx: -2 },
  { i: 1, dx: 6 },
  { i: 2, dx: 14 },
  { i: 3, dx: 22 },
  { i: 4, dx: 30 },
  { i: 5, dx: 10 },
  { i: 6, dx: 18 },
];

const BIRDS = [
  { x: 150, s: 0.8, b: 0, comb: false },
  { x: 196, s: 1.0, b: 1, comb: false },
  { x: 244, s: 1.3, b: 2, comb: true },
];

export default function FeedScene({
  mood = 'idle',
  errorTick = 0,
  className,
}: {
  mood?: SceneMood;
  errorTick?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 320 120"
      className={clsx('ff-scene', className)}
      data-mood={mood}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="160" cy="113" rx="152" ry="4.5" fill="rgba(20,50,30,0.14)" />

      {/* Sack */}
      <path d="M24 109 C19 91 21 71 30 59 L62 59 C71 71 73 91 68 109 Z" fill="#2f8f55" stroke="#1f6b3f" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="33" y="74" width="26" height="20" rx="4" fill="#f4efe0" />
      <text x="46" y="88" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#1f6b3f" fontFamily="system-ui, sans-serif">FEED</text>
      <ellipse cx="46" cy="59" rx="17" ry="5.5" fill="#d99a22" stroke="#1f6b3f" strokeWidth="1.5" />
      <ellipse cx="46" cy="58" rx="12" ry="3" fill="#efbb43" />

      {/* Birds (behind the trough). They shake once on a failed sign-in. */}
      <g key={errorTick} className={errorTick > 0 ? 'ff-shake' : undefined}>
        {BIRDS.map((bd) => (
          <g key={bd.x} transform={`translate(${bd.x} 91) scale(${bd.s})`}>
            <ellipse cx="0" cy="-10" rx="11" ry="9.5" fill="#f6c744" />
            <path d="M-7 -10 q7 -7 13 1 q-6 8 -13 -1z" fill="#e5a92a" />
            <g transform="translate(5 -17)">
              <g className="ff-peck" style={{ ['--b' as string]: bd.b }}>
                <circle cx="4" cy="-5" r="6.5" fill="#f6c744" />
                {bd.comb && <path d="M1 -10.5 q1.5 -4.5 3.6 -0.5 q2 -3.5 3.4 1z" fill="#d6453b" />}
                <path d="M9.5 -6.2 L16 -4.6 L9.5 -3z" fill="#f08a24" />
                <circle cx="7" cy="-6.6" r="1.15" fill="#2b2b2b" />
              </g>
            </g>
          </g>
        ))}
      </g>

      {/* Feed in the trough, then the trough's front face */}
      <path className="ff-heap" d="M122 92 Q190 70 262 92 Z" fill="#e0a82e" />
      <path d="M112 90 H272 L264 109 H120 Z" fill="#b07a3c" stroke="#7a5124" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M118 96 H266" stroke="#d29a57" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />

      {/* Falling pellets */}
      <g transform="translate(177 53)">
        {PELLETS.map((p) => (
          <circle
            key={p.i}
            className="ff-pellet"
            r="2.2"
            fill="#e0a82e"
            stroke="#b9831a"
            strokeWidth="0.6"
            style={{ ['--i' as string]: p.i, ['--dx' as string]: `${p.dx}px` }}
          />
        ))}
      </g>

      {/* Scoop: bowl + handle, moves between the sack and the trough */}
      <g className="ff-scoop">
        <path d="M-9 0 A9 9 0 0 0 9 0 Z" fill="#cdd5d0" stroke="#7b8780" strokeWidth="1.4" strokeLinejoin="round" />
        <ellipse cx="0" cy="0" rx="8.2" ry="2.2" fill="#efbb43" />
        <path d="M-8 -1 L-25 -15" stroke="#8a5a2b" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
