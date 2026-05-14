-- =============================================================================
-- Migration: 20260514200000_partition_job_events_template
-- STATUS: DBA-review template — DO NOT apply without:
--   1. DBA sign-off on partition key + retention schedule
--   2. Scheduled maintenance window (table rewrite required on first apply)
--   3. Verification on a staging clone
-- =============================================================================
-- This file wraps the DDL template from
-- deploy/db/partitioning/job_events_partition.sql as a Prisma raw migration.
--
-- Prisma Migrate will run this file as a raw SQL migration.
-- Apply manually via:
--   pnpm --filter @vahan360/db prisma migrate resolve --applied 20260514200000_partition_job_events_template
-- AFTER the DBA has executed the DDL against the target cluster.
--
-- DO NOT mark as applied until the DBA has confirmed the swap completed.
-- =============================================================================

-- Create new RANGE-partitioned parent (create-new-swap approach)
CREATE TABLE ingest.job_events_v2 (
    id          bigserial       NOT NULL,
    job_id      uuid            NOT NULL,
    level       text            NOT NULL,
    event_type  text            NOT NULL,
    occurred_at timestamptz(6)  NOT NULL DEFAULT now(),
    payload     jsonb
) PARTITION BY RANGE (occurred_at);

-- Initial monthly partitions — extend backward/forward to cover your oldest data.
CREATE TABLE ingest.job_events_2026_04
    PARTITION OF ingest.job_events_v2
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE ingest.job_events_2026_05
    PARTITION OF ingest.job_events_v2
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE ingest.job_events_2026_06
    PARTITION OF ingest.job_events_v2
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Default partition for rows outside explicit ranges (detach once backfill complete)
CREATE TABLE ingest.job_events_default
    PARTITION OF ingest.job_events_v2
    DEFAULT;

-- Indexes on partitioned parent (Postgres propagates to children)
CREATE INDEX idx_job_events_v2_job_occurred
    ON ingest.job_events_v2 (job_id, occurred_at DESC);

-- PK must include partition key on PG ≥ 11
ALTER TABLE ingest.job_events_v2
    ADD CONSTRAINT job_events_v2_pkey PRIMARY KEY (id, occurred_at);

-- Copy existing data (in production run this outside the transaction in batches)
INSERT INTO ingest.job_events_v2 (id, job_id, level, event_type, occurred_at, payload)
    SELECT id, job_id, level, event_type, occurred_at, payload
    FROM ingest.job_events;

-- Atomic swap
ALTER TABLE ingest.job_events RENAME TO job_events_old;
ALTER TABLE ingest.job_events_v2 RENAME TO job_events;

-- Re-add FK (was managed by Prisma on old table)
ALTER TABLE ingest.job_events
    ADD CONSTRAINT job_events_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES ingest.scrape_jobs(id) ON DELETE CASCADE;

-- Drop old table ONLY after verifying new table; comment out until verified:
-- DROP TABLE ingest.job_events_old;
