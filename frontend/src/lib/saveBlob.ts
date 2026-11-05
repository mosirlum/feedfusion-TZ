/**
 * One reliable way to save a file from the browser (CLAUDE.md #92, #93).
 *
 * Desktop: hidden link + click (revoke after a minute so slow browsers still
 * get the file).
 *
 * Phones (touch devices, iPhone Safari above all): a download that starts
 * AFTER waiting for the server is silently blocked, because the browser no
 * longer sees it as the result of a tap. So on touch devices we don't try to
 * start it by ourselves: we show a "File ready" bar with Save / Open buttons.
 * Tapping one of those is a fresh tap, so the browser lets it through (Open
 * shows the PDF/sheet in the browser viewer where Share / Print / Save to
 * Files are available).
 */
function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function startDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

let currentBar: HTMLElement | null = null;

function showReadyBar(blob: Blob, filename: string): void {
  currentBar?.remove();
  const url = URL.createObjectURL(blob);
  const bar = document.createElement('div');
  currentBar = bar;
  bar.setAttribute('role', 'status');
  bar.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:16px;z-index:10000;display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;background:#0f3d28;color:#fff;font:500 14px Inter,system-ui,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.35)';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;font-size:15px';
  title.textContent = 'Your file is ready';
  const name = document.createElement('div');
  name.style.cssText = 'opacity:.8;word-break:break-all;font-size:13px';
  name.textContent = filename;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px';
  const btn = (label: string, primary: boolean, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `flex:1;border:0;border-radius:12px;padding:12px;font:700 15px Inter,system-ui,sans-serif;cursor:pointer;${
      primary ? 'background:#22c55e;color:#04210f' : 'background:rgba(255,255,255,.14);color:#fff'
    }`;
    b.onclick = onClick;
    return b;
  };
  const close = () => {
    bar.remove();
    if (currentBar === bar) currentBar = null;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  row.appendChild(btn('Save', true, () => startDownload(url, filename)));
  row.appendChild(btn('Open', false, () => window.open(url, '_blank')));
  row.appendChild(btn('Close', false, close));
  bar.append(title, name, row);
  document.body.appendChild(bar);
}

export function saveBlob(blob: Blob, filename: string): void {
  if (isTouchDevice()) {
    showReadyBar(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  startDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
