import { PublicUser } from '../types';

const ACCESS_KEY = 'ff_access_token';
const REFRESH_KEY = 'ff_refresh_token';
const USER_KEY = 'ff_user';

// "Remember me" (2026-09-13, login page redesign, CLAUDE.md #68) — before
// this, every session unconditionally lived in localStorage, so "Remember
// me" on the login mockup had nothing real to toggle. Now a checked
// "Remember me" keeps today's behavior (localStorage, session survives
// closing the browser); unchecked stores the session in sessionStorage
// instead, so it disappears the moment that tab/window is closed.
//
// REMEMBER_KEY itself always lives in localStorage — it's just a mode flag
// ('1' | '0'), not session data — and says which storage the real session
// keys are currently in, so every getter below can find them without the
// caller having to pass the choice back in every time.
const REMEMBER_KEY = 'ff_remember';

function activeStorage(): Storage {
  return localStorage.getItem(REMEMBER_KEY) === '0' ? sessionStorage : localStorage;
}

export function getAccessToken(): string | null {
  return activeStorage().getItem(ACCESS_KEY);
}
export function getRefreshToken(): string | null {
  return activeStorage().getItem(REFRESH_KEY);
}
export function getStoredUser(): PublicUser | null {
  const raw = activeStorage().getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as PublicUser) : null;
}

export function setSession(accessToken: string, refreshToken: string, user: PublicUser, remember: boolean = true) {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  const storage = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  // Clear the other storage so a re-login with a different "Remember me"
  // choice never leaves a stale copy of the previous session sitting behind.
  other.removeItem(ACCESS_KEY);
  other.removeItem(REFRESH_KEY);
  other.removeItem(USER_KEY);
  storage.setItem(ACCESS_KEY, accessToken);
  storage.setItem(REFRESH_KEY, refreshToken);
  storage.setItem(USER_KEY, JSON.stringify(user));
}

export function setAccessToken(accessToken: string) {
  activeStorage().setItem(ACCESS_KEY, accessToken);
}

// Updates the cached user only (2026-09-12, CLAUDE.md #47) — used after a
// profile/password-change response, when the session's tokens are unchanged
// but the stored user (name/email/avatar/must_change_password) needs to
// stay in sync so a page refresh doesn't show stale data.
export function setStoredUser(user: PublicUser) {
  activeStorage().setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(REMEMBER_KEY);
}
