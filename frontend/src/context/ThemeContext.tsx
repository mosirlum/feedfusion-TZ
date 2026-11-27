import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

// Theme (2026-11-26, CLAUDE.md #98): the owner/client chose "Look A · Usiku"
// — a dark green-black look with lime highlights — as the app's main look.
// It lives in Tailwind's `dark:` layer (darkMode: 'class'), so the default is
// now 'dark'; 'light' stays available from the profile menu.
//
// The storage key moved to 'feedfusion-theme-v2' on purpose: the old
// ThemeProvider wrote its value to 'feedfusion-theme' on every load, so every
// existing user already had 'light' stored and would never have seen the new
// default. The old 'system' option (CLAUDE.md #61, an alternate light-mode
// sidebar) is retired together with the old sidebar.
//
// index.html has a tiny pre-paint script that reads the same key with the
// same default — keep the two in sync.
type Theme = 'light' | 'dark';
const STORAGE_KEY = 'feedfusion-theme-v2';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getInitialTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }, [theme]);

  // Paper is always white: drop the dark look while the browser prints, so a
  // Reports tab (whose .print-area carries dark: classes) never prints light
  // text on white paper. Matters more now that dark is the default.
  useEffect(() => {
    const root = document.documentElement;
    const before = () => root.classList.remove('dark');
    const after = () => root.classList.toggle('dark', theme === 'dark');
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
