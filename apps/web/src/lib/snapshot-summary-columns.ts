/**
 * `Processed*` summary rows store aggregates inside `snapshot` JSON (ETL / legacy shapes).
 */
export function snapshotObject(snapshot: unknown): Record<string, unknown> | null {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    return snapshot as Record<string, unknown>;
  }
  return null;
}

function pickNumberish(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return v.trim();
  }
  return '—';
}

function pickStringish(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '—';
}

/** Trip / consigner / district snapshots often mirror Mongo CRM fields. */
export function aggregateColumnsFromSnapshot(snapshot: unknown): {
  tripCount: string;
  tonnage: string;
  period: string;
} {
  const o = snapshotObject(snapshot);
  if (!o) {
    return { tripCount: '—', tonnage: '—', period: '—' };
  }
  const tripCount = pickNumberish(o, [
    'totalTrips',
    'total_trips',
    'tripCount',
    'trip_count',
    'trips',
  ]);
  const tonnage = pickNumberish(o, [
    'totalMTWeight',
    'totalMtWeight',
    'total_mt_weight',
    'tonnage',
    'totalTonnage',
    'total_tonnage',
  ]);
  let period = pickStringish(o, ['period', 'dateRange', 'date_range', 'range', 'window']);
  if (period === '—') {
    const from = pickStringish(o, ['from', 'periodFrom', 'period_from', 'startDate', 'start_date']);
    const to = pickStringish(o, ['to', 'periodTo', 'period_to', 'endDate', 'end_date']);
    if (from !== '—' || to !== '—') {
      period = `${from} → ${to}`;
    }
  }
  return { tripCount, tonnage, period };
}

/**
 * Prefer `districtKey` inside `snapshot` when present; otherwise the row's `district` column
 * (`ProcessedDistrictSummary.district`).
 */
export function districtKeyFromSummaryRow(row: {
  district?: string;
  snapshot?: unknown;
}): string {
  const o = snapshotObject(row.snapshot);
  if (o) {
    const fromSnap = pickStringish(o, ['districtKey', 'district_key', 'key']);
    if (fromSnap !== '—') return fromSnap;
  }
  if (typeof row.district === 'string' && row.district.trim()) return row.district.trim();
  return '—';
}
