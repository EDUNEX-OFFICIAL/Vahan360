import type { ScrapeJobPayload } from "./scrape-job";

export type JobEventLevel = "debug" | "info" | "warn" | "error";

/**
 * Normalized envelope for logs, queues, or `ingest.job_events` rows.
 */
export interface JobEventEnvelope<TPayload = unknown> {
  /** Monotonic or ULID per stream; optional for DB-backed events. */
  eventId?: string;
  /** FK to `ingest.scrape_jobs.id` when persisted. */
  jobId: string;
  level: JobEventLevel;
  /** Stable machine code, e.g. `scrape.page_loaded`, `db.insert_ok`. */
  eventType: string;
  occurredAt: string;
  payload?: TPayload;
}

export type ScrapeJobEventEnvelope = JobEventEnvelope<{
  jobPayload?: ScrapeJobPayload;
  message?: string;
  details?: Record<string, unknown>;
}>;
