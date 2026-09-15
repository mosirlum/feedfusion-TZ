import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { authApi, apiErrorMessage } from '../lib/api';
import { clearSession, getAccessToken, getStoredUser, setSession, setStoredUser } from '../lib/tokenStore';
import { PublicUser } from '../types';

interface AuthContextValue {
  user: PublicUser | null;
  isAuthenticated: boolean;
  isOwner: boolean;
  loading: boolean;
  // `remember` (2026-09-13, CLAUDE.md #68): true (the default) keeps the
  // long-standing behavior of always staying signed in; false signs the user
  // out automatically when the browser tab/window is closed. See tokenStore.ts.
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  // Merges a profile/password-change response into the logged-in user
  // (2026-09-12, CLAUDE.md #47) — so clearing must_change_password, or a new
  // name/email/avatar, takes effect without forcing a re-login.
  updateUser: (patch: Partial<PublicUser>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(() => (getAccessToken() ? getStoredUser() : null));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function handleExpired() {
      setUser(null);
    }
    window.addEventListener('ff:session-expired', handleExpired);
    return () => window.removeEventListener('ff:session-expired', handleExpired);
  }, []);

  async function login(email: string, password: string, remember: boolean = true) {
    setLoading(true);
    try {
      const res = await authApi.login(email, password);
      setSession(res.data.accessToken, res.data.refreshToken, res.data.user, remember);
      setUser(res.data.user);
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Could not log in. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearSession();
    setUser(null);
  }

  function updateUser(patch: Partial<PublicUser>) {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      setStoredUser(next);
      return next;
    });
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isOwner: user?.role === 'owner',
      loading,
      login,
      logout,
      updateUser,
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
