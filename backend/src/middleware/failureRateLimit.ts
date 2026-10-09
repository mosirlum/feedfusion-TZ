import { NextFunction, Request, Response } from 'express';

export interface FailureRateLimitOptions {
  /** Window length. A key's counter resets this long after its first failure. */
  windowMs: number;
  /** Failed attempts allowed per window before further requests get 429. */
  maxFailures: number;
  /** Derives the throttling key (e.g. IP + email). Return null to skip limiting. */
  keyOf: (req: Request) => string | null;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Bucket {
  failures: number;
  resetAt: number;
}

/**
 * Throttles repeated *failed* requests (wrong password, etc.) per key, so a
 * guessed-password attack on /auth/login is slowed to a crawl while ordinary
 * users who simply mistype once or twice are never affected. A successful
 * request clears the key's counter.
 *
 * Limitation, by design and worth knowing: state lives in this process's
 * memory. On Vercel each warm function instance keeps its own counters, so
 * the effective limit is per-instance, and counters vanish on a cold start.
 * That still stops the common case (a script hammering one warm instance),
 * but it is not a distributed limiter — a shared store (DB table or Redis)
 * would be needed for a hard guarantee.
 */
export function failureRateLimit(opts: FailureRateLimitOptions) {
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function prune(t: number) {
    // Bounded memory: opportunistic cleanup once the map grows.
    if (buckets.size < 500) return;
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }

  return function limiter(req: Request, res: Response, next: NextFunction) {
    const key = opts.keyOf(req);
    if (!key) return next();

    const t = now();
    prune(t);
    const existing = buckets.get(key);
    const bucket = existing && existing.resetAt > t ? existing : undefined;

    if (bucket && bucket.failures >= opts.maxFailures) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: retryAfterSec });
    }

    res.on('finish', () => {
      const status = res.statusCode;
      if (status >= 200 && status < 400) {
        buckets.delete(key);
      } else if (status === 400 || status === 401 || status === 403) {
        const t2 = now();
        const current = buckets.get(key);
        if (current && current.resetAt > t2) current.failures += 1;
        else buckets.set(key, { failures: 1, resetAt: t2 + opts.windowMs });
      }
    });

    return next();
  };
}

/** Best-effort client IP behind Vercel's proxy (first X-Forwarded-For hop). */
export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}
