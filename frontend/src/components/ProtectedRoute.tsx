import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { FullPageSpinner } from './ui';
import ForceChangePasswordPage from '../pages/ForceChangePasswordPage';

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  // Forced password change (2026-09-12, CLAUDE.md #47) — blocks all
  // navigation, regardless of role, until a real password is set. Safe to
  // check on every RequireAuth instance: the outermost one (wrapping
  // AppShell, no `roles`) already renders this instead of AppShell, so
  // nested role-gated RequireAuth checks are never even reached while true.
  if (user?.must_change_password) {
    return <ForceChangePasswordPage />;
  }
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/pos" replace />;
  }
  return <>{children}</>;
}
