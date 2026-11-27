import { ReactNode, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, ChevronDown, UserCircle, Sun, Moon, Plus, Check } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { navSections } from './navConfig';
import { UserAvatar } from '../ui';
import WelcomeBack from '../WelcomeBack';
import Chatbot from '../Chatbot';

// App shell — "Look A · Usiku" (2026-11-26, CLAUDE.md #98).
//
// Desktop: a slim icon rail (84px) that opens to full labels while the
// pointer is over it or keyboard focus is inside it, floating over the page
// instead of pushing it. This keeps the big, calm content area of the chosen
// design while every destination still has a readable name one hover away.
// Phone/tablet: the same rail as a full-width drawer, labels always shown.
// The rail is the same deep green-black in both themes — it's the brand mark.
const THEME_OPTIONS = [
  { value: 'dark' as const, label: 'Usiku (dark)', Icon: Moon },
  { value: 'light' as const, label: 'Light', Icon: Sun },
];

export function AppShell() {
  const { user, logout, isOwner } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (user ? item.roles.includes(user.role) : false)),
    }))
    .filter((section) => section.items.length > 0);

  // Labels: always visible in the phone drawer; on desktop only while the rail is open.
  const reveal = 'lg:opacity-0 lg:group-hover/rail:opacity-100 lg:group-focus-within/rail:opacity-100 transition-opacity duration-150';
  const canSell = user ? ['owner', 'sales', 'manager'].includes(user.role) : false;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-transparent">
      <aside
        aria-label="Main navigation"
        className={clsx(
          // `app-sidebar` is the print-CSS hook (CLAUDE.md #63) — keep it.
          'app-sidebar group/rail fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-hidden border-r border-white/[0.06] bg-[#0b1712] text-white shadow-2xl shadow-black/30 transition-[transform,width] duration-200 ease-out',
          'lg:w-[84px] lg:translate-x-0 lg:shadow-none lg:hover:w-64 lg:hover:shadow-2xl lg:focus-within:w-64 lg:focus-within:shadow-2xl',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 px-[18px] pb-4 pt-5">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white">
            <img src="/logo.png" alt="Feed Fusion Tanzania" className="h-10 w-10 object-contain" />
          </span>
          <div className={clsx('min-w-0 whitespace-nowrap', reveal)}>
            <p className="font-display text-[15px] font-bold leading-tight tracking-tight">Feed Fusion</p>
            <p className="text-[11px] tracking-[0.14em] text-[#8fa596]">TANZANIA</p>
          </div>
          <button
            className="ml-auto rounded-lg p-2 text-white/80 hover:bg-white/10 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-[18px] pb-4 [scrollbar-width:none]">
          {visibleSections.map((section, i) => (
            <div key={section.title} className={clsx(i > 0 && 'mt-3')}>
              <div className="relative flex h-6 items-center">
                <span className={clsx('absolute left-1 right-1 top-1/2 h-px bg-white/[0.08] lg:block', 'hidden', 'lg:group-hover/rail:hidden lg:group-focus-within/rail:hidden')} />
                <p className={clsx('whitespace-nowrap px-3 text-[11px] font-semibold text-[#8fa596]', reveal)}>{section.title}</p>
              </div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      'mb-1 flex h-12 items-center gap-3 rounded-2xl text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/70',
                      isActive
                        ? 'bg-lime-400 font-semibold text-[#0b1712]'
                        : 'font-medium text-[#b9cbbd] hover:bg-white/[0.07] hover:text-white'
                    )
                  }
                >
                  <span className="flex w-12 flex-shrink-0 justify-center">
                    <item.icon size={20} strokeWidth={2} />
                  </span>
                  <span className={clsx('whitespace-nowrap pr-3', reveal)}>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.08] px-[18px] py-3">
          <button
            onClick={handleLogout}
            title="Log out"
            className="flex h-12 w-full items-center gap-3 rounded-2xl text-sm font-medium text-[#b9cbbd] transition-colors hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/70"
          >
            <span className="flex w-12 flex-shrink-0 justify-center">
              <LogOut size={20} />
            </span>
            <span className={clsx('whitespace-nowrap', reveal)}>Log out</span>
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="lg:pl-[84px]">
        <header className="app-topbar sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#0b1712]/70 sm:px-6 lg:px-8">
          <button
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-[#a9bcae] dark:hover:bg-white/[0.07] lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="flex-1" />

          {/* Pages that already show their own "New sale" button skip this one. */}
          {canSell && !['/pos', '/dashboard', '/sales-history'].includes(pathname) && (
            <Link
              to="/pos"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-green-600 px-4 text-sm font-semibold text-white transition hover:bg-green-700 active:scale-[0.98] dark:bg-lime-400 dark:font-bold dark:text-[#0b1712] dark:hover:bg-lime-300"
            >
              <Plus size={17} strokeWidth={2.6} />
              <span className="hidden sm:inline">New sale</span>
            </Link>
          )}

          <div className="relative">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              aria-expanded={profileOpen}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/[0.07]"
            >
              <UserAvatar name={user?.name ?? '?'} src={user?.avatar_data_url} size={34} />
              <div className="hidden text-left sm:block">
                <p className="text-sm font-semibold leading-tight text-slate-700 dark:text-[#e9f1eb]">{user?.name}</p>
                <p className="text-xs capitalize leading-tight text-slate-500 dark:text-[#8fa596]">{user?.role}</p>
              </div>
              <ChevronDown size={16} className="text-slate-400 dark:text-[#8fa596]" />
            </button>
            {profileOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-panel animate-fade-in dark:border-white/[0.1] dark:bg-[#11211a]">
                  <div className="border-b border-slate-100 px-4 py-3 dark:border-white/[0.08]">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-[#e9f1eb]">{user?.email}</p>
                    {isOwner && <Badge>Owner</Badge>}
                  </div>
                  <NavLink
                    to="/profile"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d2dbd5] dark:hover:bg-white/[0.06]"
                  >
                    <UserCircle size={16} /> My Profile
                  </NavLink>
                  <div className="border-t border-slate-100 px-4 pb-1 pt-2.5 text-xs font-semibold text-slate-500 dark:border-white/[0.08] dark:text-[#8fa596]">
                    Look
                  </div>
                  {THEME_OPTIONS.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      aria-pressed={theme === value}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d2dbd5] dark:hover:bg-white/[0.06]"
                    >
                      <Icon size={16} /> <span className="flex-1 text-left">{label}</span>
                      {theme === value && <Check size={16} className="text-green-600 dark:text-lime-400" />}
                    </button>
                  ))}
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-sm text-danger-600 hover:bg-danger-50 dark:border-white/[0.08] dark:text-danger-300 dark:hover:bg-danger-900/40"
                  >
                    <LogOut size={16} /> Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="max-w-[1600px] p-4 sm:p-6 lg:p-8">
          <div key={pathname} className="ff-page">
            <Outlet />
          </div>
        </main>
      </div>

      <WelcomeBack />
      <Chatbot />
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-lime-400/15 dark:text-lime-300">
      {children}
    </span>
  );
}
