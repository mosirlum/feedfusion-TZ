/**
 * A small animated robot mascot for Msaidizi (2026-11-27, CLAUDE.md #99
 * follow-up) — the client asked for the chatbot to "have emotion": smiling,
 * moving around, winking, waving. Hand-drawn inline SVG (no image/animation
 * library) with pure CSS keyframe animations so it's cheap and themeable.
 *
 * States:
 *  - idle: floats gently, blinks every few seconds on its own.
 *  - waving: one arm waves (used briefly when the chat opens).
 *  - talking: a subtle mouth/bob pulse while the bot "speaks" an answer.
 */
import clsx from 'clsx';
import './robot.css';

export type RobotMood = 'idle' | 'happy' | 'wink' | 'think' | 'sad';

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
  /** Face expression (like Crowny in Crowned): idle, happy, wink, think, sad. */
  mood?: RobotMood;
  className?: string;
}) {
  const LIME = '#c6f36f';
  const arc = (cx: number) => (
    <path d={`M${cx - 4} 27 Q${cx} 20 ${cx + 4} 27`} fill="none" stroke={LIME} strokeWidth="2.6" strokeLinecap="round" />
  );
  const dx = mood === 'think' ? 2 : 0;
  const dy = mood === 'think' ? -1.5 : mood === 'sad' ? 1.5 : 0;
  const bothArcs = mood === 'happy';
  const leftArc = mood === 'happy' || mood === 'wink';
  return (
    <div
      className={clsx('ff-robot', talking && 'ff-robot-talking', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        {/* antenna */}
        <line x1="32" y1="4" x2="32" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="ff-robot-stroke" />
        <circle cx="32" cy="4" r="3" className="ff-robot-tip" />

        {/* waving arm (left, from the robot's own perspective: right on screen) */}
        <g className={clsx('ff-robot-arm', waving && 'ff-robot-arm-wave')} style={{ transformOrigin: '50px 34px' }}>
          <circle cx="50" cy="34" r="5" className="ff-robot-body" />
        </g>
        {/* still arm */}
        <circle cx="14" cy="34" r="5" className="ff-robot-body" />

        {/* body */}
        <rect x="18" y="30" width="28" height="22" rx="10" className="ff-robot-body" />

        {/* head */}
        <rect x="12" y="10" width="40" height="30" rx="14" className="ff-robot-head" />

        {/* face plate */}
        <rect x="18" y="16" width="28" height="18" rx="9" className="ff-robot-face" />

        {/* eyes: arcs for happy/wink, round otherwise (round eyes blink via CSS) */}
        {leftArc ? (
          arc(25)
        ) : (
          <g className="ff-robot-eyes" style={{ transformOrigin: '25px 25px' }}>
            <circle cx={25 + dx} cy={25 + dy} r="3.2" className="ff-robot-eye" />
          </g>
        )}
        {bothArcs ? (
          arc(39)
        ) : (
          <g className={clsx('ff-robot-eyes', mood === 'idle' && 'ff-robot-eye-right')} style={{ transformOrigin: '39px 25px' }}>
            <circle cx={39 + dx} cy={25 + dy} r="3.2" className="ff-robot-eye" />
          </g>
        )}
        {mood === 'sad' && (
          <>
            <path d="M21 20 L28 18" stroke={LIME} strokeWidth="1.6" strokeLinecap="round" />
            <path d="M36 18 L43 20" stroke={LIME} strokeWidth="1.6" strokeLinecap="round" />
            <path d="M21.5 28 Q19.5 31 21.5 32.5 Q23.5 31 21.5 28 Z" fill="#a8ecff" />
          </>
        )}
        {(mood === 'happy' || mood === 'wink') && (
          <>
            <circle cx="20" cy="30" r="2.2" fill="#ff8a96" opacity="0.5" />
            <circle cx="44" cy="30" r="2.2" fill="#ff8a96" opacity="0.5" />
          </>
        )}

        {/* mouth follows the mood */}
        <g className="ff-robot-mouthwrap" style={{ transformOrigin: '32px 30px' }}>
          {mood === 'happy' ? (
            <path d="M26 29 Q32 38 38 29 Z" fill={LIME} stroke={LIME} strokeWidth="1.4" strokeLinejoin="round" />
          ) : mood === 'think' ? (
            <ellipse cx="34" cy="31" rx="2" ry="2.3" fill="none" stroke={LIME} strokeWidth="1.8" />
          ) : mood === 'sad' ? (
            <path d="M27 33 Q32 28 37 33" className="ff-robot-mouth" fill="none" strokeWidth="2.2" strokeLinecap="round" />
          ) : (
            <path d="M24 30 Q32 35 40 30" className="ff-robot-mouth" fill="none" strokeWidth="2.4" strokeLinecap="round" />
          )}
        </g>
        {mood === 'think' && (
          <g fill="#f3d77a">
            <circle className="ff-robot-dot ff-robot-d1" cx="54" cy="10" r="1.3" />
            <circle className="ff-robot-dot ff-robot-d2" cx="58" cy="6" r="1.8" />
            <circle className="ff-robot-dot ff-robot-d3" cx="62" cy="1.5" r="2.2" />
          </g>
        )}
      </svg>
    </div>
  );
}
