export function tzs(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  return `TZS ${n.toLocaleString('en-TZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Cash Control Center redesign (2026-09-12, CLAUDE.md #39) — "4:32 PM" style
// time-only display for the History table's own Time column, separate from
// its Date column (formatDateTime always bundles both together).
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Reports page date-range presets (2026-09-13, CLAUDE.md #62) — the owner
// asked for quick Week/Month/Year presets and a specific-month picker
// alongside the existing custom From/To range, instead of only ever typing
// two dates by hand. All local-time (not UTC), matching how the two
// existing date-only helpers above already behave (toISOString() slicing
// happens after local field math, so this doesn't drift a day at the UTC
// boundary the way `new Date(isoString)` parsing sometimes does elsewhere
// in this codebase).
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Monday-start week (the convention already used for Cash Control's own
// "this week" grouping) — returns [from, to] as ISO date strings.
export function currentWeekRange(): [string, string] {
  const now = new Date();
  const dow = now.getDay(); // 0 = Sunday
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  const start = new Date(now);
  start.setDate(now.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const today = new Date();
  return [toIso(start), toIso(end > today ? today : end)];
}

export function currentYearRange(): [string, string] {
  const now = new Date();
  return [toIso(new Date(now.getFullYear(), 0, 1)), toIso(now)];
}

// monthIndex is 0-11. Clamps the end date to today when the picked month is
// the current (in-progress) month, so a "September" report run mid-month
// doesn't show a range extending into the future.
export function monthRange(year: number, monthIndex: number): [string, string] {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const today = new Date();
  return [toIso(start), toIso(end > today ? today : end)];
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Shared by PurchasesPage's supplier picker and the Suppliers page's avatar
// chips (2026-09-11) — was duplicated in PurchasesPage.tsx before, moved
// here so both stay in sync.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Change Approval Center redesign (2026-09-11, CLAUDE.md #36) — "2h ago"
// style relative timestamps for the request feed and Recent Activity
// sidebar. Falls back to a plain date once it's more than a week old,
// rather than a meaningless "12d ago" that keeps climbing forever.
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(d);
}

// A user's role as shown next to their name in the Change Approval Center
// (2026-09-11, CLAUDE.md #36) — no dedicated "job title" field exists in
// this schema, so this labels the real `role` column plainly rather than
// inventing a title like "Purchase Officer".
export function roleLabel(role: string): string {
  if (role === 'owner') return 'Owner';
  if (role === 'sales') return 'Sales Staff';
  if (role === 'manager') return 'Manager';
  return role;
}

// Windowed page numbers for table pagination footers (2026-09-14,
// CLAUDE.md #68) — the owner asked what happens once a list grows past a
// couple of pages: Sales History, Products and Inventory were each
// rendering one button per page with no limit, so a shop with a few
// hundred sales/products would eventually get a single row of 30-40+
// number buttons, wrapping awkwardly instead of behaving like "next
// pages." Always keeps the first and last page, plus up to `delta` pages
// on either side of the current one, and marks any gap with a single
// 'gap' entry the caller renders as "…" — the same shape Expenses'
// pagination footer already used, just factored out so the other pages
// don't each re-derive it slightly differently.
// Compact axis-label formatting for the Reports "Sales Overview" chart
// (2026-09-14, CLAUDE.md #68) — the chart's new y-axis gridline labels need
// to fit inside a ~30px left margin, so a raw comma'd TZS figure like
// "334,000" is too wide; this abbreviates to "334K" / "1.2M" instead. Kept
// separate from `tzs()`, which intentionally stays full-precision for
// anywhere money is actually being read as an exact figure (stat cards,
// tables, receipts) — only the axis label needs the shorthand.
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function pageWindow(current: number, total: number, delta = 1): (number | 'gap')[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const pages: number[] = [];
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - current) <= delta) pages.push(n);
  }
  return pages.reduce<(number | 'gap')[]>((acc, n) => {
    const prev = acc[acc.length - 1];
    if (typeof prev === 'number' && n - prev > 1) acc.push('gap');
    acc.push(n);
    return acc;
  }, []);
}
