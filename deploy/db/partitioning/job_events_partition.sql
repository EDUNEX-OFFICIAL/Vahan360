-- =============================================================================
-- Range partitioning for ingest.job_events
-- =============================================================================
-- STATUS: DBA-review template — DO NOT apply without:
--   1. DBA sign-off on the partition key + retention schedule.
--   2. Verified maintenance window (table rewrite required on first apply).
--   3. Prisma migrations for any FK/index changes noted below.
--
-- Current state: Prisma manages ingest.job_events as a plain append table.
-- This script converts it to a RANGE-partitioned table by occurred_at (month).
--
-- Approach: create-new-swap (avoids full-table lock on large tables).
--   Step 1: Create the partitioned parent + initial child partitions.
--   Step 2: Migrate data from the old table into the new partitioned one.
--   Step 3: Rename tables (atomic swap with ACCESS EXCLUSIVE lock).
--   Step 4: Drop the old table.
--   Step 5: Re-add FK from ingest.scrape_jobs.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create the new partitioned parent (same columns as Prisma model).
--    job_events_v2 is a temporary name used during the swap.
-- ---------------------------------------------------------------------------
CREATE TABLE ingest.job_events_v2 (
    id          bigserial       NOT NULL,
    job_id      uuid            NOT NULL,
    level       text            NOT NULL,
    event_type  text            NOT NULL,
    occurred_at timestamptz(6)  NOT NULL DEFAULT now(),
    payload     jsonb
) PARTITION BY RANGE (occurred_at);

-- ---------------------------------------------------------------------------
-- 2. Create initial monthly partitions — adjust range to cover your oldest
--    data. Use the maintenance script below to add future months.
-- ---------------------------------------------------------------------------

-- Template: 3 rolling months. Extend backward / forward as needed.
CREATE TABLE ingest.job_events_2026_04
    PARTITION OF ingest.job_events_v2
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE ingest.job_events_2026_05
    PARTITION OF ingest.job_events_v2
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE ingest.job_events_2026_06
    PARTITION OF ingest.job_events_v2
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Default partition catches rows that don't fit any explicit range.
-- Useful during migration; can be detached/dropped once covered.
CREATE TABLE ingest.job_events_default
    PARTITION OF ingest.job_events_v2
    DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. Indexes on the partitioned table (Postgres propagates to children).
--    Must match idx_job_events_job_occurred from Prisma schema.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_job_events_v2_job_occurred
    ON ingest.job_events_v2 (job_id, occurred_at DESC);

-- Primary key (bigserial). Partition key must be included in PK on PG ≥ 11.
ALTER TABLE ingest.job_events_v2
    ADD CONSTRAINT job_events_v2_pkey PRIMARY KEY (id, occurred_at);

-- ---------------------------------------------------------------------------
-- 4. Copy existing data (batched in production to avoid long-running txn).
--    In production, run this outside the transaction in batches:
--      INSERT INTO ingest.job_events_v2 SELECT * FROM ingest.job_events
--        WHERE occurred_at >= '...' AND occurred_at < '...'
--    Here we keep it simple for the template.
-- ---------------------------------------------------------------------------
INSERT INTO ingest.job_events_v2 (id, job_id, level, event_type, occurred_at, payload)
    SELECT id, job_id, level, event_type, occurred_at, payload
    FROM ingest.job_events;

-- ---------------------------------------------------------------------------
-- 5. Atomic swap.
-- ---------------------------------------------------------------------------
ALTER TABLE ingest.job_events RENAME TO job_events_old;
ALTER TABLE ingest.job_events_v2 RENAME TO job_events;

-- Re-add FK from scrape_jobs (Prisma managed, dropped with old table).
ALTER TABLE ingest.job_events
    ADD CONSTRAINT job_events_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES ingest.scrape_jobs(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Drop old table (only after verifying new table is correct).
--    Comment this out and run manually after verification.
-- ---------------------------------------------------------------------------
-- DROP TABLE ingest.job_events_old;

COMMIT;


-- =============================================================================
-- Maintenance: add the next month's partition (run via CronJob or DBA script).
-- =============================================================================
-- CREATE TABLE ingest.job_events_YYYY_MM
--     PARTITION OF ingest.job_events
--     FOR VALUES FROM ('YYYY-MM-01') TO ('YYYY-MM+1-01');


-- =============================================================================
-- Retention: detach + drop old partitions (e.g. keep 12 months).
-- =============================================================================
-- ALTER TABLE ingest.job_events DETACH PARTITION ingest.job_events_YYYY_MM;
-- DROP TABLE ingest.job_events_YYYY_MM;


-- =============================================================================
-- Prisma note
-- =============================================================================
-- After this migration Prisma continues to work as-is because it queries
-- ingest.job_events by name. The partition key (occurred_at) must be present
-- in every INSERT — Prisma's default(now()) satisfies this automatically.
-- If you use Prisma Migrate, add a raw SQL migration file wrapping the DDL
-- above (migrations/<timestamp>_partition_job_events/migration.sql).
