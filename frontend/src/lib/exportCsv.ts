/**
 * Shared CSV export helpers (2026-09-12, CLAUDE.md #42) — extracted from
 * Expenses' own "Export" button (CLAUDE.md #40, the first page to add a
 * client-side CSV download) so every page that offers one — Expenses and
 * now every Reports tab — builds the file the same way, with the same
 * quoting rule, instead of a second copy that could drift.
 */
import { saveBlob } from './saveBlob';

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const lines = [header.map((h) => csvEscape(String(h))).join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(String(v))).join(','));
  }
  // BOM so Excel opens Swahili/accents correctly; saveBlob() does the reliable save.
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  saveBlob(blob, filename);
}
