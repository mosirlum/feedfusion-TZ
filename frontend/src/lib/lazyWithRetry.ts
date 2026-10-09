import { ComponentType, lazy } from 'react';

const RELOAD_FLAG = 'ff:chunk-reload';

/**
 * `React.lazy` with one automatic recovery path for a stale deployment: when
 * a new version ships, the old hashed chunk files disappear, and a tab that
 * was open before the deploy fails with "Failed to fetch dynamically
 * imported module" the first time it navigates to a not-yet-loaded page.
 * Reloading once picks up the new index.html + chunk names. The
 * sessionStorage flag stops a genuine outage (chunk really unreachable) from
 * turning into a reload loop — the second failure is thrown to the caller.
 */
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        /* storage unavailable (private mode) — recovery still works, just unguarded */
      }
      return mod;
    } catch (err) {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        /* can't guard against a loop without storage — don't reload */
      }
      if (!alreadyReloaded) {
        window.location.reload();
        // Never resolves: the page is reloading, so React never renders a half-state.
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
