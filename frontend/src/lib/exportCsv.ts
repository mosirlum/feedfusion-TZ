/**
 * Shared CSV export helpers (2026-09-12, CLAUDE.md #42) — extracted from
 * Expenses' own "Export" button (CLAUDE.md #40, the first page to add a
 * client-side CSV download) so every page that offers one — Expenses and
 * now every Reports tab — builds the file the same way, with the same
 * quoting rule, instead of a second copy that could drift.
 */
export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const lines = [header.map((h) => csvEscape(String(h))).join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(String(v))).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
