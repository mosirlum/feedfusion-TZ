/**
 * Msaidizi's robot: a friendly white-and-silver robot with a dark visor face
 * and glowing cyan eyes, wearing the Feed Fusion logo (three circles: paw,
 * fish, leaf) on its chest. Hand-drawn inline SVG + CSS keyframes (no image
 * or animation library), so it is light and works in dark and light themes.
 *
 * Moods (like Crowny in Crowned Perfumes): idle, happy, wink, think, sad.
 * `waving` loops a wave of the right arm; `talking` pulses the mouth.
 */
import clsx from 'clsx';
import './robot.css';

export type RobotMood = 'idle' | 'happy' | 'wink' | 'think' | 'sad';

const CY = '#4de1ff';
const GLOW = { filter: 'drop-shadow(0 0 2px rgba(77,225,255,.85))' } as const;

export default function RobotAvatar({
  size = 40,
  waving = false,
  talking = false,
  mood = 'idle',
  className,
}: {
  size?: number;
  waving?: boolean;
  talking?: boolean;
  mood?: RobotMood;
  className?: string;
}) {
  const arc = (cx: number) => (
    <path d={`M${cx - 5} 31 Q${cx} 22 ${cx + 5} 31`} fill="none" stroke={CY} strokeWidth="3" strokeLinecap="round" style={GLOW} />
  );
  const dx = mood === 'think' ? 2.5 : 0;
  const dy = mood === 'think' ? -2 : mood === 'sad' ? 2 : 0;
  const bothArcs = mood === 'happy';
  const leftArc = mood === 'happy' || mood === 'wink';

  return (
    <div className={clsx('ff-robot', talking && 'ff-robot-talking', className)} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="ffRbW" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#cdd3da" />
          </linearGradient>
        </defs>

        {/* left arm (still) */}
        <rect x="13" y="58" width="12" height="30" rx="6" fill="url(#ffRbW)" stroke="#b4bcc7" strokeWidth="1.2" />
        {/* right arm (waves) */}
        <g className={clsx(waving && 'ff-robot-arm-wave')} style={{ transformOrigin: '80px 60px' }}>
          <rect x="75" y="58" width="12" height="30" rx="6" fill="url(#ffRbW)" stroke="#b4bcc7" strokeWidth="1.2" />
        </g>

        {/* body */}
        <rect x="26" y="52" width="48" height="44" rx="22" fill="url(#ffRbW)" stroke="#b4bcc7" strokeWidth="1.3" />
        <path d="M36 90 Q50 95 64 90" fill="none" stroke="#c3cad4" strokeWidth="1.3" strokeLinecap="round" />

        {/* Feed Fusion logo on the chest: three circles + swoosh */}
        <g>
          <circle cx="41" cy="72" r="4.6" fill="#2E9B2E" stroke="#fff" strokeWidth="1.2" />
          <circle cx="50" cy="72" r="4.6" fill="#0B4FA8" stroke="#fff" strokeWidth="1.2" />
          <circle cx="59" cy="72" r="4.6" fill="#2E9B2E" stroke="#fff" strokeWidth="1.2" />
          <path d="M37 81 Q50 85 63 79" fill="none" stroke="#1E7A1E" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M45 83.5 Q54 83.5 63 79" fill="none" stroke="#0B4FA8" strokeWidth="1.8" strokeLinecap="round" />
        </g>

        {/* neck + head */}
        <rect x="41" y="48" width="18" height="8" rx="3" fill="#aeb6c0" />
        <ellipse cx="11" cy="29" rx="4.2" ry="9" fill="#cfd5dc" stroke="#b4bcc7" strokeWidth="1.2" />
        <ellipse cx="89" cy="29" rx="4.2" ry="9" fill="#cfd5dc" stroke="#b4bcc7" strokeWidth="1.2" />
        <rect x="14" y="4" width="72" height="50" rx="23" fill="url(#ffRbW)" stroke="#b4bcc7" strokeWidth="1.3" />
        <rect x="21" y="11" width="58" height="36" rx="16" fill="#10243a" />
        <path d="M27 17 Q40 12 54 14" fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="2.4" strokeLinecap="round" />

        {/* eyes: arcs for happy/wink, round otherwise (round eyes blink via CSS) */}
        {leftArc ? (
          arc(37)
        ) : (
          <g className="ff-robot-eyes" style={{ transformOrigin: '37px 28px', ...GLOW }}>
            <ellipse cx={37 + dx} cy={28 + dy} rx="4" ry="5" fill={CY} />
          </g>
        )}
        {bothArcs ? (
          arc(63)
        ) : (
          <g className={clsx('ff-robot-eyes', mood === 'idle' && 'ff-robot-eye-right')} style={{ transformOrigin: '63px 28px', ...GLOW }}>
            <ellipse cx={63 + dx} cy={28 + dy} rx="4" ry="5" fill={CY} />
          </g>
        )}
        {mood === 'sad' && (
          <>
            <path d="M30 20 L43 17" stroke={CY} strokeWidth="2" strokeLinecap="round" />
            <path d="M57 17 L70 20" stroke={CY} strokeWidth="2" strokeLinecap="round" />
            <path d="M32 33 Q29 38 32 40.5 Q35 38 32 33 Z" fill="#a8ecff" />
          </>
        )}
        {(mood === 'happy' || mood === 'wink') && (
          <>
            <circle cx="28" cy="38" r="3" fill="#ff8a96" opacity="0.45" />
            <circle cx="72" cy="38" r="3" fill="#ff8a96" opacity="0.45" />
          </>
        )}

        {/* mouth follows the mood */}
        <g className="ff-robot-mouthwrap" style={{ transformOrigin: '50px 38px', ...GLOW }}>
          {mood === 'happy' ? (
            <path d="M43 35 Q50 46 57 35 Z" fill={CY} stroke={CY} strokeWidth="1.4" strokeLinejoin="round" />
          ) : mood === 'think' ? (
            <ellipse cx="52" cy="39" rx="2.6" ry="3" fill="none" stroke={CY} strokeWidth="2" />
          ) : mood === 'sad' ? (
            <path d="M44 41 Q50 35 56 41" fill="none" stroke={CY} strokeWidth="2.6" strokeLinecap="round" />
          ) : (
            <path d="M43 36 Q50 43 57 36" fill="none" stroke={CY} strokeWidth="2.8" strokeLinecap="round" />
          )}
        </g>

        {mood === 'think' && (
          <g fill="#f3d77a">
            <circle className="ff-robot-dot ff-robot-d1" cx="88" cy="8" r="1.6" />
            <circle className="ff-robot-dot ff-robot-d2" cx="93" cy="3" r="2.2" />
            <circle className="ff-robot-dot ff-robot-d3" cx="98" cy="-3" r="2.8" />
          </g>
        )}
      </svg>
    </div>
  );
}
