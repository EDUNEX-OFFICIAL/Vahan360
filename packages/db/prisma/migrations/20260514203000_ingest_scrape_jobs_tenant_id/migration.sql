-- Multi-tenant ingest isolation: namespace scrape jobs (raw rows link via scrape_job_id).
ALTER TABLE "ingest"."scrape_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS "idx_scrape_jobs_tenant_created" ON "ingest"."scrape_jobs" ("tenant_id", "created_at" DESC);
