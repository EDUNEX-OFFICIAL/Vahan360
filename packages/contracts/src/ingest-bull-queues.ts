/**
 * Default BullMQ queue names for scrape ingest (override per process via
 * `INGEST_QUEUE_NAME`, `INGEST_CHILD_QUEUE_NAME`, `INGEST_DLQ_QUEUE_NAME`,
 * `INGEST_RETRY_QUEUE_NAME`).
 */
export const INGEST_BULL_QUEUE_DEFAULTS = {
  master: "scrape-ingest",
  child: "scrape-ingest-child",
  dlq: "scrape-ingest-dlq",
  retry: "scrape-ingest-retry",
} as const;
