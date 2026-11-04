import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './components/ui/Toast';
import './index.css';

// Updates: when a new version of the app takes over (service worker, see
// vite.config.ts autoUpdate), the page on screen is still the old one. We never
// reload by force (a cashier could lose a half-made sale), so show a small
// "Refresh" pill instead. Skipped on the very first install.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return;
    shown = true;
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:14px;background:#0f3d28;color:#fff;font:600 14px Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)';
    bar.textContent = 'A new version of Feed Fusion is ready';
    const btn = document.createElement('button');
    btn.textContent = 'Refresh';
    btn.style.cssText = 'border:0;border-radius:10px;padding:6px 12px;background:#22c55e;color:#04210f;font:700 13px Inter,system-ui,sans-serif;cursor:pointer';
    btn.onclick = () => window.location.reload();
    bar.appendChild(btn);
    document.body.appendChild(bar);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
