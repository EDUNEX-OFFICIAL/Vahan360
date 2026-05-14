import type { Prisma } from '@vahan360/db';

/** Parses optional ISO-ish date boundaries for Prisma datetime filters (invalid → omit). */
export function updatedAtRangeClause(
  fromRaw?: string,
  toRaw?: string,
): Prisma.DateTimeFilter | undefined {
  const lo = parseIsoOptional(fromRaw);
  const hi = parseIsoOptional(toRaw);
  if (!lo && !hi) return undefined;
  return { ...(lo ? { gte: lo } : {}), ...(hi ? { lte: hi } : {}) };
}

export function capturedAtRangeClause(
  fromRaw?: string,
  toRaw?: string,
): Prisma.DateTimeFilter | undefined {
  return updatedAtRangeClause(fromRaw, toRaw);
}

function parseIsoOptional(raw?: string): Date | undefined {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
