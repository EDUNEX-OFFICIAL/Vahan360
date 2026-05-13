/**
 * Minimal client-side CSV export utility.
 * No external package required — uses Blob + URL.createObjectURL.
 *
 * Usage:
 *   downloadCsv({
 *     filename: 'scrape-jobs.csv',
 *     columns: ['id', 'kind', 'status', 'createdAt'],
 *     rows: rows.map(r => [r.id, r.kind, r.status, r.createdAt]),
 *   });
 */

export interface CsvExportOptions {
  filename: string;
  /** Column header labels in order. */
  columns: string[];
  /** Parallel arrays of cell values. Each inner array must match columns length. */
  rows: (string | number | boolean | null | undefined)[][];
}

/** Escape a single cell value per RFC 4180. */
function escapeCell(value: string | number | boolean | null | undefined): string {
  const s = value == null ? '' : String(value);
  // Quote if contains comma, double-quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvString(opts: CsvExportOptions): string {
  const lines: string[] = [];
  lines.push(opts.columns.map(escapeCell).join(','));
  for (const row of opts.rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return lines.join('\r\n');
}

/** Trigger a CSV file download in the browser. No-op in SSR (no `document`). */
export function downloadCsv(opts: CsvExportOptions): void {
  if (typeof document === 'undefined') return;
  const csv = buildCsvString(opts);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename.endsWith('.csv') ? opts.filename : `${opts.filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
