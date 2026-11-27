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

export default function RobotAvatar({
  size = 40,
  waving = false,
  talking = false,
  className,
}: {
  size?: number;
  waving?: boolean;
  talking?: boolean;
  className?: string;
}) {
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

        {/* eyes (blink via CSS scaleY) */}
        <g className="ff-robot-eyes" style={{ transformOrigin: '25px 25px' }}>
          <circle cx="25" cy="25" r="3.2" className="ff-robot-eye" />
        </g>
        <g className="ff-robot-eyes ff-robot-eye-right" style={{ transformOrigin: '39px 25px' }}>
          <circle cx="39" cy="25" r="3.2" className="ff-robot-eye" />
        </g>

        {/* smiling mouth */}
        <g className="ff-robot-mouthwrap" style={{ transformOrigin: '32px 30px' }}>
          <path d="M24 30 Q32 35 40 30" className="ff-robot-mouth" fill="none" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
