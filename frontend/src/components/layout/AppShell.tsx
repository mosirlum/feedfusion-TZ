import { ReactNode, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, ChevronDown, UserCircle, Sun, Monitor, Moon } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { navSections } from './navConfig';
import { UserAvatar } from '../ui';

const THEME_OPTIONS = [
  { value: 'light' as const, label: 'Light theme', Icon: Sun },
  { value: 'system' as const, label: 'System (original sidebar)', Icon: Monitor },
  { value: 'dark' as const, label: 'Dark theme', Icon: Moon },
];

export function AppShell() {
  const { user, logout, isOwner } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0c1310]">
      {/* Sidebar — solid deep forest-green gradient for Light and Dark (same
          as the approved dashboard artifact: the sidebar stays this look
          regardless of those two themes, only the content area switches).
          "System" is the one exception (CLAUDE.md #61): the owner asked for
          a third option that keeps the rest of the app identical to Light
          but brings back the app's original green→blue diagonal sidebar
          gradient — reconstructed from the app's own pre-redesign brand
          colors (#3B6D11 green / #185FA5 blue, still used in receipts and
          report charts) since the exact old gradient rule itself wasn't
          preserved anywhere before this redesign. */}
      <aside
        className={clsx(
          // `app-sidebar` (2026-09-13, CLAUDE.md #63) — a stable hook for
          // print CSS to hide this specific sidebar, since a bare `aside`
          // tag selector would also match the unrelated slide-in detail
          // panels in SuppliersPage.tsx/AuditLogPage.tsx.
          'app-sidebar fixed inset-y-0 left-0 z-40 w-64 transform text-white transition-transform duration-200 lg:translate-x-0',
          theme === 'system' ? 'bg-[linear-gradient(135deg,#3B6D11_0%,#185FA5_100%)]' : 'bg-brand-gradient',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 px-5 py-5">
            <img
              src="/logo.png"
              alt="Feed Fusion Tanzania"
              className="h-11 w-11 rounded-xl bg-white/95 p-1.5 object-contain shadow-lg shadow-black/20"
            />
            <div>
              <p className="font-display font-extrabold leading-tight tracking-tight">Feed Fusion</p>
              <p className="text-[11px] uppercase tracking-widest text-green-200/70">Tanzania</p>
            </div>
            <button className="ml-auto lg:hidden text-white/80" onClick={() => setMobileOpen(false)}>
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 pb-4">
            {visibleSections.map((section) => (
              <div key={section.title} className="mb-4">
                <p className="px-3 pb-1.5 pt-3 text-[10.5px] font-bold uppercase tracking-wider text-green-200/50">
                  {section.title}
                </p>
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors mb-0.5',
                        isActive
                          ? 'bg-green-500 text-green-950 font-semibold shadow-md shadow-black/20'
                          : 'text-green-100/80 hover:bg-white/10 hover:text-white'
                      )
                    }
                  >
                    <item.icon size={17} strokeWidth={2} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="border-t border-white/10 px-3 py-3">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-green-100/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut size={17} />
              Log out
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main column */}
      <div className="lg:pl-64">
        <header className="app-topbar sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-[rgba(255,255,255,0.08)] dark:bg-[#121a16]/90">
          <button className="lg:hidden text-slate-500 dark:text-[#97a49b]" onClick={() => setMobileOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="flex-1" />

          {/* Light / System / Dark picker (CLAUDE.md #61) — replaces the
              single sun/moon toggle from #56 (removed in #59 while a
              dev-server caching bug made dark mode look broken; restored
              now that #60 found and fixed the real cause). Three explicit
              buttons rather than a cycling toggle, since a single icon
              can't clearly represent three states. */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-[rgba(255,255,255,0.14)] dark:bg-[#0e1512]">
            {THEME_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                title={label}
                aria-label={label}
                aria-pressed={theme === value}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                  theme === value
                    ? 'bg-white text-green-700 shadow-sm dark:bg-[#17211c] dark:text-green-300'
                    : 'text-slate-400 hover:text-slate-600 dark:text-[#77857c] dark:hover:text-[#b6c2ba]'
                )}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>

          <div className="relative">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-[#0e1512] transition-colors"
            >
              <UserAvatar name={user?.name ?? '?'} src={user?.avatar_data_url} size={32} />
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium text-slate-700 dark:text-[#d2dbd5] leading-tight">{user?.name}</p>
                <p className="text-xs capitalize text-slate-400 dark:text-[#77857c] leading-tight">{user?.role}</p>
              </div>
              <ChevronDown size={16} className="text-slate-400 dark:text-[#77857c]" />
            </button>
            {profileOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-panel animate-fade-in dark:border-[rgba(255,255,255,0.14)] dark:bg-[#0e1512]">
                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-[rgba(255,255,255,0.14)]">
                    <p className="text-sm font-medium text-slate-700 dark:text-[#d2dbd5] truncate">{user?.email}</p>
                    {isOwner && <Badge>Owner</Badge>}
                  </div>
                  <NavLink
                    to="/profile"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-[#d2dbd5] dark:hover:bg-[#17211c]"
                  >
                    <UserCircle size={15} /> My Profile
                  </NavLink>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-danger-600 hover:bg-danger-50 dark:text-danger-300 dark:hover:bg-danger-900/40"
                  >
                    <LogOut size={15} /> Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="mt-0.5 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/60 dark:text-green-300">
      {children}
    </span>
  );
}
