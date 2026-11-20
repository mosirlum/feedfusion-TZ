import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Lock, Moon, Sun, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getStoredUser } from '../lib/tokenStore';
import LoginScene from '../components/login/LoginScene';
import { BottomBar, CornerBottomRight, CornerTopRight, Leaf, LogoMark } from '../components/login/LoginArt';
import { useDayNight } from '../components/login/useDayNight';
import '../components/login/login.css';

// Feed Fusion sign-in: a farm scene that slowly turns to night when nobody
// touches the page (see components/login/useDayNight.ts for the timing and
// loginConfig.ts for the numbers) and back to day on any activity.
// CLAUDE.md #97 has the full description.
//
// Two things differ from the mockup on purpose:
//   - the backend signs in with an e-mail address, so the first field accepts
//     the e-mail (placeholder says so);
//   - there is no public sign-up, so "Create Account" explains that the shop
//     owner adds users (Users page).
const REMEMBER_USER_KEY = 'ff_login_user';

function readSavedUser(): string {
  try {
    return localStorage.getItem(REMEMBER_USER_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function LoginPage() {
  const { login, isAuthenticated, isOwner } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const celebrating = useRef(false);
  const { pRef, isNight, manual, cardHidden, enterTick, toggleManual, setBusy } = useDayNight(rootRef);

  const saved = readSavedUser();
  const [identifier, setIdentifier] = useState(saved);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ id?: string; pw?: string; form?: string }>({});
  const [hint, setHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);

  // Nobody can tab into or click a card that has faded out.
  useEffect(() => {
    cardRef.current?.toggleAttribute('inert', cardHidden);
  }, [cardHidden]);

  // The card comes back with the sunrise: put the cursor in the first field (not on phones, where it would pop the keyboard).
  useEffect(() => {
    if (enterTick <= 1) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (!coarse && !welcome) userRef.current?.focus({ preventScroll: true });
  }, [enterTick, welcome]);

  if (isAuthenticated && !celebrating.current && !welcome) {
    const dest = location.state?.from?.pathname ?? (isOwner ? '/dashboard' : '/pos');
    return <Navigate to={dest} replace />;
  }

  function fail(next: { id?: string; pw?: string; form?: string }) {
    setErrors({ ...next, form: next.form ? next.form.charAt(0).toUpperCase() + next.form.slice(1) : undefined });
    const el = cardRef.current; // restart the shake without remounting the form
    if (el) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setHint(null);
    const id = identifier.trim();
    const next: { id?: string; pw?: string } = {};
    if (!id) next.id = 'Enter your username or e-mail.';
    if (!password) next.pw = 'Enter your password.';
    if (next.id || next.pw) {
      fail(next);
      (next.id ? userRef.current : document.getElementById('fl-pw'))?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);
    setBusy(true);
    celebrating.current = true;
    try {
      await login(id, password, remember);
      try {
        if (remember) localStorage.setItem(REMEMBER_USER_KEY, id);
        else localStorage.removeItem(REMEMBER_USER_KEY);
      } catch {
        /* private mode: nothing to remember */
      }
      const name = (getStoredUser()?.name ?? '').trim().split(/\s+/)[0] || id;
      setWelcome(name);
      const dest = location.state?.from?.pathname ?? '/';
      window.setTimeout(() => navigate(dest, { replace: true }), 1200);
    } catch (err) {
      celebrating.current = false;
      setBusy(false);
      setSubmitting(false);
      fail({ form: err instanceof Error ? err.message : 'Could not sign in. Try again.' });
    }
  }

  return (
    <div className="fl" ref={rootRef}>
      <LoginScene pRef={pRef} />
      <CornerTopRight />
      <CornerBottomRight />
      <BottomBar />

      <button
        type="button"
        className="fl-toggle"
        onClick={toggleManual}
        aria-label={manual ? 'Back to daytime' : 'Show the farm at night'}
        aria-pressed={manual}
        title={manual ? 'Back to daytime' : 'Show the farm at night'}
      >
        {isNight ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
      </button>

      <main className="fl-cardwrap">
        <div
          ref={cardRef}
          className="fl-card fl-enter"
          onAnimationEnd={(e) => e.animationName === 'fl-shake' && e.currentTarget.classList.remove('shake')}
          data-hidden={cardHidden}
          aria-hidden={cardHidden}
        >
          <div style={{ display: 'contents' }} key={enterTick}>
            <div className="fl-st" style={{ ['--i' as string]: 0 }}>
              <LogoMark className="fl-logo" />
            </div>
            <h1 className="fl-st" style={{ ['--i' as string]: 1 }}>Welcome Back!</h1>
            <p className="fl-sub fl-st" style={{ ['--i' as string]: 2 }}>Sign in to manage your feed business efficiently</p>

            <form className="fl-form" onSubmit={handleSubmit} noValidate>
              <div className="fl-st" style={{ ['--i' as string]: 3 }}>
                <div className="fl-field">
                  <User className="fl-ic" aria-hidden="true" />
                  <label htmlFor="fl-user" className="sr-only-fl">Username or e-mail</label>
                  <input
                    id="fl-user"
                    ref={userRef}
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Username or e-mail"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (errors.id || errors.form) setErrors({ ...errors, id: undefined, form: undefined });
                    }}
                    aria-invalid={!!errors.id}
                    aria-describedby={errors.id ? 'fl-user-err' : undefined}
                  />
                </div>
                {errors.id && <p id="fl-user-err" className="fl-err" role="alert">{errors.id}</p>}
              </div>

              <div className="fl-st" style={{ ['--i' as string]: 4 }}>
                <div className="fl-field">
                  <Lock className="fl-ic" aria-hidden="true" />
                  <label htmlFor="fl-pw" className="sr-only-fl">Password</label>
                  <input
                    id="fl-pw"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.pw || errors.form) setErrors({ ...errors, pw: undefined, form: undefined });
                    }}
                    aria-invalid={!!errors.pw}
                    aria-describedby={errors.pw ? 'fl-pw-err' : undefined}
                  />
                  <button
                    type="button"
                    className="fl-eye"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    aria-pressed={showPw}
                  >
                    {showPw ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
                {errors.pw && <p id="fl-pw-err" className="fl-err" role="alert">{errors.pw}</p>}
              </div>

              <div className="fl-row fl-st" style={{ ['--i' as string]: 5 }}>
                <label className="fl-check">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>Remember Me</span>
                </label>
                <button
                  type="button"
                  className="fl-link"
                  onClick={() => setHint("There's no self-reset yet. Please contact the shop owner to reset your password.")}
                >
                  Forgot Password?
                </button>
              </div>

              {errors.form && <p className="fl-formerr" role="alert">{errors.form}</p>}
              {hint && <p className="fl-hint" role="status">{hint}</p>}

              <div className="fl-st" style={{ ['--i' as string]: 6 }}>
                <button type="submit" className="fl-btn primary" disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className="fl-spin" aria-hidden="true" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <span>Login</span>
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>

              <div className="fl-or fl-st" style={{ ['--i' as string]: 7 }}>or</div>

              <div className="fl-st" style={{ ['--i' as string]: 8 }}>
                <button
                  type="button"
                  className="fl-btn ghost"
                  onClick={() => setHint('Accounts are created by the shop owner (Users page). Ask them to add you.')}
                >
                  Create Account
                </button>
              </div>
            </form>

            <p className="fl-tag fl-st" style={{ ['--i' as string]: 9 }}>
              <Leaf />
              <span>Healthy Animals. Productive Farms. Food Security.</span>
            </p>
          </div>
        </div>
      </main>

      {welcome && (
        <div className="fl-welcome" role="status" aria-live="polite">
          <div>
            <p>Welcome back,</p>
            <b>{welcome}</b>
          </div>
        </div>
      )}
    </div>
  );
}
