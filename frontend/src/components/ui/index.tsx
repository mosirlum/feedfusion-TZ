import { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#121a16]',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2.5 text-sm',
        size === 'lg' && 'px-5 py-3 text-base',
        variant === 'primary' &&
          'bg-green-600 text-white shadow-card hover:bg-green-700 active:bg-green-800 focus-visible:ring-green-400',
        variant === 'secondary' &&
          'bg-blue-600 text-white shadow-card hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-blue-400',
        variant === 'outline' &&
          'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-300 dark:border-[rgba(255,255,255,0.2)] dark:bg-[#0e1512] dark:text-[#d2dbd5] dark:hover:bg-[#17211c]',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-300 dark:text-[#b6c2ba] dark:hover:bg-[#0e1512]',
        variant === 'danger' &&
          'bg-danger-500 text-white shadow-card hover:bg-danger-600 focus-visible:ring-red-300',
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-card border border-slate-200 bg-white shadow-card dark:border-[rgba(255,255,255,0.08)] dark:bg-[#121a16]',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">
      <div>
        <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 dark:text-[#97a49b] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode;
  tone?: 'slate' | 'green' | 'blue' | 'red' | 'amber';
  className?: string;
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-[#0e1512] dark:text-[#b6c2ba]',
    green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
    red: 'bg-danger-50 text-danger-600 dark:bg-danger-900/50 dark:text-danger-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// IconChip — small tinted icon badge used in card headers (Purchases, and
// anywhere else a section header wants a colored icon rather than plain text)
// ---------------------------------------------------------------------------
export function IconChip({
  icon,
  tone = 'green',
  size = 34,
}: {
  icon: ReactNode;
  tone?: 'green' | 'blue' | 'amber' | 'red' | 'slate';
  size?: number;
}) {
  const tones: Record<string, string> = {
    green: 'bg-green-50 text-green-600 dark:bg-green-900/40 dark:text-green-300',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-danger-50 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300',
    slate: 'bg-slate-100 text-slate-500 dark:bg-[#0e1512] dark:text-[#97a49b]',
  };
  return (
    <div
      className={clsx('flex flex-shrink-0 items-center justify-center rounded-[10px]', tones[tone])}
      style={{ width: size, height: size }}
    >
      {icon}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={clsx('block text-sm font-medium text-slate-700 dark:text-[#b6c2ba] mb-1', className)} {...rest} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={clsx(
        'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 transition-colors',
        'focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100',
        'disabled:bg-slate-50 disabled:text-slate-400',
        'dark:border-[rgba(255,255,255,0.14)] dark:bg-[#0e1512] dark:text-[#eef3ef] dark:placeholder:text-[#77857c] dark:focus:border-green-500 dark:focus:ring-green-900/40 dark:disabled:bg-[#121a16] dark:disabled:text-[#556059]',
        className
      )}
      {...rest}
    />
  );
});

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 transition-colors',
        'focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100',
        'dark:border-[rgba(255,255,255,0.14)] dark:bg-[#0e1512] dark:text-[#eef3ef] dark:placeholder:text-[#77857c] dark:focus:border-green-500 dark:focus:ring-green-900/40',
        className
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 transition-colors',
        'focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100',
        'dark:border-[rgba(255,255,255,0.14)] dark:bg-[#0e1512] dark:text-[#eef3ef] dark:focus:border-green-500 dark:focus:ring-green-900/40',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#77857c] border-b border-slate-200 dark:border-[rgba(255,255,255,0.08)]">
      {children}
    </thead>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx('px-4 py-3 text-left whitespace-nowrap', className)}>{children}</th>;
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx('px-4 py-3 text-slate-700 dark:text-[#b6c2ba] whitespace-nowrap', className)}>{children}</td>;
}
export function Tr({ children, className, ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={clsx(
        'border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors dark:border-[rgba(255,255,255,0.08)] dark:hover:bg-[#0e1512]/40',
        className
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin text-green-600', className)} />;
}

export function FullPageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="mb-2 text-slate-300 dark:text-[#97a49b]">{icon}</div>}
      <p className="font-medium text-slate-600 dark:text-[#b6c2ba]">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-400 dark:text-[#77857c]">{description}</p>}
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div className="flex items-center gap-3">
        {icon && <IconChip tone="blue" size={40} icon={icon} />}
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-800 dark:text-[#f4f8f5]">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 dark:text-[#97a49b] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'green',
  hint,
  delta,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: 'green' | 'blue' | 'amber' | 'red' | 'purple';
  hint?: ReactNode;
  // Optional trend pill (2026-09-12, CLAUDE.md #56 — dashboard artifact
  // redesign) — only render this when a page genuinely has a real
  // period-over-period comparison to show; omit it rather than fabricate a
  // percentage. `direction` controls the arrow + green/red coloring.
  delta?: { value: string; direction: 'up' | 'down' };
}) {
  const tones: Record<string, string> = {
    green: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-danger-50 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        {icon ? <div className={clsx('rounded-[10px] p-2', tones[tone])}>{icon}</div> : <span />}
        {delta && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
              delta.direction === 'up'
                ? 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-danger-50 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300'
            )}
          >
            {delta.direction === 'up' ? '↗' : '↘'} {delta.value}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-[#97a49b]">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold text-slate-800 dark:text-[#f4f8f5]">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-[#77857c]">{hint}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart colors — sampled from the app's own brand palette (tailwind.config.js)
// rather than a generic chart-library default, so every donut/bar chart in
// the app shares one fixed categorical order. Originally local to Suppliers
// (CLAUDE.md #30); shared here (2026-09-12, CLAUDE.md #41) so Reports' new
// charts use the exact same order rather than a second, driftable copy.
// ---------------------------------------------------------------------------
// Updated 2026-09-12 (CLAUDE.md #56) to the dataviz-skill validated
// categorical palette from the approved dashboard artifact — CVD-checked
// (protanopia/deuteranopia) rather than picked by eye. Order is fixed and
// should not be reshuffled (see the artifact-design skill's color-formula
// notes on why order matters for colorblind safety).
export const CHART_COLORS = ['#0f9d58', '#2a78d6', '#eb6834', '#c2402b', '#b7bcb2'];

// ---------------------------------------------------------------------------
// UserAvatar — colored-initials avatar chip, hashed from a name so the same
// person always gets the same color. Originally local to Audit Log (CLAUDE.md
// #43); shared here (2026-09-12, CLAUDE.md #44) once the Users page needed
// the same thing, so a third copy doesn't drift from the other two.
// ---------------------------------------------------------------------------
export const AVATAR_TONES = ['bg-green-600', 'bg-blue-600', 'bg-purple-600', 'bg-amber-600', 'bg-pink-600', 'bg-teal-600'];
export function avatarTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}
// `src` is new (2026-09-12, CLAUDE.md #47) — a user's own avatar photo
// (`avatar_data_url`, a base64 data: URL), shown instead of colored initials
// wherever it's present. Every existing caller (Audit Log, Users) just
// passes a name and keeps getting initials, since the field is optional.
export function UserAvatar({
  name,
  size = 24,
  className,
  src,
}: {
  name: string;
  size?: number;
  className?: string;
  src?: string | null;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={clsx('flex-shrink-0 rounded-full object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={clsx('flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white', avatarTone(name), className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
    >
      {initialsOf(name)}
    </span>
  );
}
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Donut chart — hand-rolled SVG (no charting library in this project) using
// the stacked-stroke-dasharray technique, so each slice is just a circle
// segment rotated into place. Shared by Suppliers (Purchase Share) and
// Reports (Revenue by Category / by Staff).
// ---------------------------------------------------------------------------
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: Array<{ name: string; value: number; color: string; pct: number }>;
  centerValue: string;
  centerLabel: string;
}) {
  const size = 132;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-slate-100 dark:stroke-[rgba(255,255,255,0.14)]"
          strokeWidth={strokeWidth}
        />
        {slices.map((slice) => {
          const dash = (slice.pct / 100) * circumference;
          const el = (
            <circle
              key={slice.name}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-cumulative}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${slice.name}: ${slice.pct.toFixed(1)}%`}</title>
            </circle>
          );
          cumulative += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="font-display text-[13px] font-extrabold text-slate-800 dark:text-[#eef3ef]">{centerValue}</p>
        <p className="text-[10px] text-slate-400 dark:text-[#77857c]">{centerLabel}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        className={clsx(
          'relative z-10 w-full rounded-card bg-white shadow-panel animate-fade-in max-h-[90vh] flex flex-col dark:bg-[#121a16] dark:border dark:border-[rgba(255,255,255,0.08)]',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
          // Added 2026-09-11 (Change Approval Center's Edit Sale modal,
          // CLAUDE.md #35) — a line-item edit table needs more room than
          // 'lg' comfortably gives; every existing caller is unaffected.
          size === 'xl' && 'max-w-4xl'
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">
          <h3 className="font-display font-bold text-slate-800 dark:text-[#eef3ef]">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-[#77857c] dark:hover:text-[#eef3ef] text-xl leading-none">
            &times;
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-[rgba(255,255,255,0.08)]">{footer}</div>}
      </div>
    </div>
  );
}
