import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

// Three-way theme picker: Light / System / Dark (2026-09-12, CLAUDE.md #61).
// "System" here is NOT "follow the OS light/dark preference" (that's the
// #58 bug we deliberately removed) — the owner defined it as its own third
// look: identical to Light everywhere except the sidebar, which uses the
// app's original green→blue diagonal gradient instead of the current
// mockup's solid forest-green. Dark is the full dark theme from #56-#58.
// Tailwind is configured with `darkMode: 'class'` (tailwind.config.js), so
// every `dark:` utility across the app activates purely from the presence
// of a `dark` class on <html> — that class is only added for 'dark', never
// for 'system'. The System-only sidebar swap is handled by AppShell.tsx
// reading `theme` directly (see AppShell.tsx), not by Tailwind's dark: variant.
type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'feedfusion-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  // Fixed 2026-09-12 (CLAUDE.md #58) — this used to fall back to the
  // device/browser's OS preference, so anyone whose phone/laptop was set to
  // dark mode landed on the dark theme on first visit without ever asking
  // for it, which read as "the app is stuck in the wrong colors." The owner
  // was explicit: light should always be the default, white, clean look;
  // dark (and now "system") are opt-in via the picker, never inherited
  // from the OS.
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
