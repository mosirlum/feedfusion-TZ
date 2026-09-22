import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA support (2026-09-22) — the owner asked to make the app installable on
// a phone home screen. This only adds a manifest + a service worker that
// pre-caches the built app shell (JS/CSS/icons) so it loads instantly on a
// repeat visit; it does NOT add offline sales-recording or any behavior
// change to the app itself — every API call still goes straight to the
// network exactly as before. registerType: 'autoUpdate' means a new
// deployment replaces the cached shell in the background on next visit,
// so it can never trap a user on a stale build.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Feed Fusion Tanzania',
        short_name: 'Feed Fusion',
        description: 'POS, inventory, and business control for Feed Fusion Tanzania.',
        theme_color: '#1c7d4f',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only precache the built app shell — never API responses, so
        // stock levels/prices/etc. are always fetched fresh, never served
        // stale from a cache.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
