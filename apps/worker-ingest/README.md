# @vahan360/worker-ingest

BullMQ consumer for scrape-ingest (master + child queues), optional Playwright smoke, queue metrics, DLQ/retry wiring. Copy **`./.env.example`** to **`.env`**.

## Scraping / ingest

- **Adaptive throttle (optional):** set **`INGEST_BACKOFF_BASE_MS` > 0** to pause the process after each **terminal** child-queue failure for `min(base × multiplier^consecutiveFailures, INGEST_BACKOFF_MAX_MS)` (defaults: **`INGEST_BACKOFF_MAX_MS`** = 30000, **`INGEST_BACKOFF_MULTIPLIER`** = 2). Counter resets on any successful child job completion. Logs include **`backoffMs`** when applied (`msg: ingest.child.backoff`).
