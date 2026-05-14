import type { IngestChildJobType } from "./ingest-child-job-type";

/**
 * Discriminated scrape job payloads (control plane → worker).
 * DB rows may store the same shape as JSON; TS keeps the contract explicit.
 */
export const SCRAPE_JOB_KINDS = [
  "khanan_date_range",
  "vehicle_permit_snapshot",
  "vehicle_insurance_snapshot",
  "vehicle_fitness_snapshot",
  "vehicle_registration_snapshot",
  "consigner_digest",
  "trip_intelligence_rollup",
  "raw_challan_backfill",
] as const;

export type ScrapeJobKind = (typeof SCRAPE_JOB_KINDS)[number];

export const SCRAPE_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export type ScrapeJobStatus = (typeof SCRAPE_JOB_STATUSES)[number];

export interface ScrapeIngestQueueData {
  scrapeJobId: string;
  kind: ScrapeJobKind;
  correlationId: string;
  /** Retry fan-in loop guard when jobs are re-queued from `scrape-ingest-retry`. */
  replayAttempts?: number;
}

/** BullMQ `scrape-ingest-child` payload (master fan-out + DLQ/retry replay). */
export interface ScrapeIngestChildQueueData {
  scrapeJobId: string;
  kind: ScrapeJobKind;
  correlationId: string;
  step: string;
  progressPercent?: number;
  requestId?: string;
  traceparent?: string;
  tracestate?: string;
  /** Optional slice / stage hint (see `IngestChildJobType`). */
  type?: IngestChildJobType;
  /** Bull master job id when fan-out originates from `scrape-ingest` (optional). */
  parentJobId?: string;
  /** Idempotency / routing hint for parallel slice jobs (optional). */
  sliceKey?: string;
  /** Retry worker / manual replay loop guard (opaque to DB). */
  replayAttempts?: number;
}

export interface ScrapeJobPayloadBase {
  kind: ScrapeJobKind;
  /** Idempotent replays / tracing (UUID recommended). */
  correlationId: string;
  /** Optional actor or service name. */
  requestedBy?: string;
  /** Arbitrary routing hints (district codes, feature flags, etc.). */
  metadata?: Record<string, unknown>;
}

export interface KhananDateRangeScrapePayload extends ScrapeJobPayloadBase {
  kind: "khanan_date_range";
  fromDate: string;
  toDate: string;
  district?: string;
}

export interface VehiclePermitSnapshotPayload extends ScrapeJobPayloadBase {
  kind: "vehicle_permit_snapshot";
  vehicleRegNo: string;
}

export interface VehicleInsuranceSnapshotPayload extends ScrapeJobPayloadBase {
  kind: "vehicle_insurance_snapshot";
  vehicleRegNo: string;
}

/** VAHAN / portal fitness validity capture (worker persistence still stub-grade). */
export interface VehicleFitnessSnapshotPayload extends ScrapeJobPayloadBase {
  kind: "vehicle_fitness_snapshot";
  vehicleRegNo: string;
}

/** Registration detail snapshot for a vehicle (worker persistence still stub-grade). */
export interface VehicleRegistrationSnapshotPayload extends ScrapeJobPayloadBase {
  kind: "vehicle_registration_snapshot";
  vehicleRegNo: string;
}

/** Consigner-side digest job (routes to Khanan-style intelligence in workers). */
export interface ConsignerDigestPayload extends ScrapeJobPayloadBase {
  kind: "consigner_digest";
  /** Stable key: GSTIN, portal consigner id, or normalized name slug. */
  consignerKey: string;
}

/** Trip / movement rollup for one vehicle (processed-layer target). */
export interface TripIntelligenceRollupPayload extends ScrapeJobPayloadBase {
  kind: "trip_intelligence_rollup";
  vehicleRegNo: string;
}

export interface RawChallanBackfillPayload extends ScrapeJobPayloadBase {
  kind: "raw_challan_backfill";
  /** Source-specific cursor or batch token. */
  cursor?: string;
  batchSize?: number;
}

export type ScrapeJobPayload =
  | KhananDateRangeScrapePayload
  | VehiclePermitSnapshotPayload
  | VehicleInsuranceSnapshotPayload
  | VehicleFitnessSnapshotPayload
  | VehicleRegistrationSnapshotPayload
  | ConsignerDigestPayload
  | TripIntelligenceRollupPayload
  | RawChallanBackfillPayload;
