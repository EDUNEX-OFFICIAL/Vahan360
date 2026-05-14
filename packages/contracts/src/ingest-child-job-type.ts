/**
 * Discriminators for future multi-slice ingest child jobs (portal / slice routing).
 * String union only — workers may ignore unknown values until handlers exist.
 */
export const INGEST_CHILD_JOB_TYPES = [
  "consigner",
  "vehicle",
  "challan_detail",
  "permit",
  "insurance",
  "fitness",
  "registration",
  "trip_summary",
  "analytics_rollup",
  "validation",
  "dedupe",
] as const;

export type IngestChildJobType = (typeof INGEST_CHILD_JOB_TYPES)[number];

export function isIngestChildJobType(value: unknown): value is IngestChildJobType {
  return (
    typeof value === "string" &&
    (INGEST_CHILD_JOB_TYPES as readonly string[]).includes(value)
  );
}
