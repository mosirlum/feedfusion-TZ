/**
 * Calendar-date helpers shared by the Business Growth services.
 *
 * The one timezone-sensitive step is `todayInTanzania()`: this code runs on a
 * server (Vercel) whose process timezone is UTC, so reading `new Date()`'s
 * local fields would silently give the UTC date. Instead the current instant
 * is shifted by Tanzania's fixed UTC+3 offset (no DST) and read via its UTC
 * fields. Everything else here is pure 'YYYY-MM-DD' string/calendar math.
 */
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayInTanzania(now: number = Date.now()): string {
  const d = new Date(now + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday-start weeks, same convention as the frontend's currentWeekRange(). */
export function mondayOnOrBefore(iso: string): string {
  const dow = weekdayOf(iso);
  return addDaysIso(iso, -(dow === 0 ? 6 : dow - 1));
}

export function toDateOnlyIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** 'YYYY-MM' of a 'YYYY-MM-DD' string. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** First day of the month `offset` months before/after the month containing `iso`. */
export function firstOfMonthOffset(iso: string, offset: number): string {
  const [y, m] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-01`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/**
 * The instant (epoch ms) that is calendar date `iso` at the *current Tanzania
 * time of day*. Used for backdated sales: the date the user picked is a
 * Tanzania calendar date, so it must be combined with the Tanzania wall-clock
 * time, not the server's (UTC) one. For Tanzania's own "today" this returns
 * `now` exactly. Returns null for a malformed or impossible date.
 */
export function tanzaniaDateAtCurrentTime(iso: string, now: number = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const wall = new Date(now + TZ_OFFSET_MS); // Tanzania wall clock, read via UTC fields
  return (
    Date.UTC(y, mo - 1, d, wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), wall.getUTCMilliseconds()) -
    TZ_OFFSET_MS
  );
}
