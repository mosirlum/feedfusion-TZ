import { FormEvent, ReactNode, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authApi, apiErrorMessage } from '../lib/api';
import { Button, Input, Label } from '../components/ui';

/**
 * Forced password change (2026-09-12, CLAUDE.md #47) — shown instead of the
 * whole app (ProtectedRoute.tsx's RequireAuth renders this in place of
 * AppShell) whenever the logged-in user's `must_change_password` is true:
 * a brand-new account's first login, or right after the owner resets
 * someone's forgotten password. Requires the current (temporary) password
 * even here — they just used it to sign in, so it adds no real friction,
 * and it stops a leaked access token alone from being enough to take over
 * the account by "changing" its password.
 */
export default function ForceChangePasswordPage() {
  const { user, updateUser, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authApi.changePassword(currentPassword, newPassword);
      updateUser(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change your password.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-2 bg-slate-50">
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-brand-gradient p-12 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 60%, white 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <img src="/logo.png" alt="Feed Fusion Tanzania" className="h-14 w-14 rounded-xl bg-white/95 p-1.5 object-contain shadow-lg" />
          <div>
            <p className="text-xl font-extrabold tracking-tight">Feed Fusion</p>
            <p className="text-xs uppercase tracking-[0.25em] text-white/70">Tanzania</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight">One quick step before you continue.</h2>
          <p className="mt-4 text-white/80 leading-relaxed">
            For your security, a temporary password can only be used once. Set a password only you know to unlock
            the rest of the system.
          </p>
          <div className="mt-10 flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-white/15 p-1.5">
              <ShieldCheck size={18} />
            </div>
            <p className="text-sm text-white/85 leading-snug">
              Nothing else about your account changes — you'll go straight back to where you'd normally land.
            </p>
          </div>
        </div>

        <p className="relative text-xs text-white/50">&copy; {new Date().getFullYear()} Feed Fusion Tanzania. All rights reserved.</p>
      </div>

      <div className="flex min-h-screen items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <img src="/logo.png" alt="Feed Fusion Tanzania" className="h-16 w-16 object-contain" />
          </div>

          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-green-50 p-2.5 text-green-700">
              <KeyRound size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 dark:text-[#eef3ef]">Set a new password</h1>
              <p className="text-sm text-slate-500 dark:text-[#97a49b]">
                {user?.name ? `Hi ${user.name.split(' ')[0]}, ` : ''}you need to set your own password before continuing.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="currentPassword">Temporary password</Label>
              <PasswordField
                id="currentPassword"
                autoComplete="current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                show={showPasswords}
                onToggleShow={() => setShowPasswords((v) => !v)}
              />
            </div>
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <PasswordField
                id="newPassword"
                autoComplete="new-password"
                value={newPassword}
                onChange={setNewPassword}
                show={showPasswords}
                onToggleShow={() => setShowPasswords((v) => !v)}
                placeholder="At least 6 characters"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <PasswordField
                id="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                show={showPasswords}
                onToggleShow={() => setShowPasswords((v) => !v)}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-600">{error}</div>
            )}

            <Button type="submit" className="w-full" loading={submitting}>
              Set new password
            </Button>
          </form>

          <button
            onClick={logout}
            className="mt-6 w-full text-center text-xs text-slate-400 dark:text-[#77857c] hover:text-slate-600"
            type="button"
          >
            Not you? Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  id,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete?: string;
  placeholder?: string;
}): ReactNode {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder ?? '••••••••'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="pr-10"
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c] hover:text-slate-600"
        tabIndex={-1}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
