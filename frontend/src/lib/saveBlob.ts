/**
 * One reliable way to save a file from the browser (2026-11-05, CLAUDE.md #92).
 *
 * Every download in the app used to create a blob URL, click a hidden link and
 * revoke the URL on the very next line. Desktop Chrome usually gets away with
 * that, but mobile Chrome / Safari and slower machines start the download
 * AFTER the revoke and fail ("Failed - no file" / nothing happens). Revoking
 * only after a minute fixes that. `noopener` keeps the click from affecting the
 * page and the link is attached to the DOM first (Firefox/Safari need that).
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
