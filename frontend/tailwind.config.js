/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Whole-app visual redesign (2026-09-12, CLAUDE.md #56) — the owner asked
  // for the "Feed Fusion Dashboard" concept artifact to become the app's
  // main theme everywhere, with a light/dark toggle. Tailwind's class
  // strategy toggles dark mode by adding/removing `dark` on <html>
  // (ThemeContext.tsx does that) rather than only following the OS setting,
  // so the in-app toggle actually works.
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Manrope for headings/big numbers, Inter for body/UI text — the
        // same pairing as the approved dashboard artifact. Replaces Plus
        // Jakarta Sans (2026-09-11's "stronger visual pass", CLAUDE.md #45)
        // which the owner has now explicitly moved on from in favor of this
        // new direction; both families are loaded in index.css.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Re-sampled from the approved dashboard redesign artifact
        // (2026-09-12, CLAUDE.md #56), replacing the previous olive-green /
        // navy pair. Same Tailwind keys (green-50..900, blue-50..900,
        // danger-*) as before, so every existing `bg-green-600` etc. across
        // the app picks up the new palette automatically — no per-page
        // class-name changes needed for the base recolor.
        green: {
          50: '#eef8f0',
          100: '#dcf1e3',
          200: '#b7e4c8',
          300: '#8ed3a4',
          400: '#57b87c',
          500: '#1f9e5d',
          600: '#1c7d4f',
          700: '#124a35',
          800: '#0d3b2a',
          900: '#0a2e21',
        },
        blue: {
          50: '#eaf2fc',
          100: '#d3e6f8',
          200: '#a8cdf1',
          300: '#7bb0e8',
          400: '#4a90de',
          500: '#2a78d6',
          600: '#1f5fae',
          700: '#194b89',
          800: '#133a69',
          900: '#0d2a4d',
        },
        danger: {
          50: '#fbeae7',
          100: '#f6d3cd',
          200: '#ecab9e',
          300: '#de7d6a',
          400: '#d35d47',
          500: '#c2402b',
          600: '#a3301e',
          700: '#832418',
          800: '#661c12',
          900: '#4a140d',
        },
        // New chart-only slot (donut/line charts) — kept distinct from the
        // `green`/`blue` UI scales above so recoloring a button never
        // silently recolors a chart series. Values are the dataviz-skill
        // validated categorical palette from the artifact (CVD-checked).
        chart: {
          green: '#0f9d58',
          blue: '#2a78d6',
          orange: '#eb6834',
          neutral: '#b7bcb2',
        },
      },
      borderRadius: {
        card: '1.125rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(10, 46, 33, 0.05), 0 8px 20px -14px rgba(10, 46, 33, 0.45)',
        panel: '0 4px 16px -4px rgba(10, 46, 33, 0.14), 0 2px 6px -2px rgba(10, 46, 33, 0.08)',
      },
      backgroundImage: {
        // Vertical deep-forest sidebar gradient (was a green->blue diagonal)
        // — matches the artifact's sidebar exactly.
        'brand-gradient': 'linear-gradient(180deg, #0a2e21 0%, #0d3b2a 70%)',
      },
    },
  },
  plugins: [],
};
