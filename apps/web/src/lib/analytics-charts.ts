import type { StatusBarChartItem } from '@/components/StatusBarChart';

/** Aggregate rows into top-N buckets by string key (e.g. district labels). */
export function chartTopStringBuckets<T>(
  rows: T[],
  keyFn: (row: T) => string,
  topN = 15,
): StatusBarChartItem[] {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const k = keyFn(r).trim() || '(empty)';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([label, value]) => ({ label, value }));
}

/** Bucket rows by UTC year-month of `updatedAt` for lightweight slice histograms. */
export function chartMonthBucketsFromIso(rows: { updatedAt: string }[]): StatusBarChartItem[] {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const d = new Date(r.updatedAt);
    const label = Number.isNaN(d.getTime())
      ? 'invalid-date'
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));
}
