-- Initial ingest schema + tables (generated via `prisma migrate diff --from-empty --to-schema-datamodel`; safe for CI `prisma migrate deploy`).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ingest";

-- CreateTable
CREATE TABLE "ingest"."scrape_jobs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL,
    "idempotency_key" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest"."job_events" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest"."raw_challans" (
    "id" BIGSERIAL NOT NULL,
    "scrape_job_id" UUID,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_url" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_challans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest"."raw_permits" (
    "id" BIGSERIAL NOT NULL,
    "scrape_job_id" UUID,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_url" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest"."raw_insurances" (
    "id" BIGSERIAL NOT NULL,
    "scrape_job_id" UUID,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_url" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_insurances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scrape_jobs_idempotency_key_key" ON "ingest"."scrape_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_scrape_jobs_status_priority_created" ON "ingest"."scrape_jobs"("status", "priority", "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_job_events_job_occurred" ON "ingest"."job_events"("job_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "raw_challans_content_hash_key" ON "ingest"."raw_challans"("content_hash");

-- CreateIndex
CREATE INDEX "idx_raw_challan_job" ON "ingest"."raw_challans"("scrape_job_id");

-- CreateIndex
CREATE INDEX "idx_raw_challan_captured" ON "ingest"."raw_challans"("captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "raw_permits_content_hash_key" ON "ingest"."raw_permits"("content_hash");

-- CreateIndex
CREATE INDEX "idx_raw_permit_job" ON "ingest"."raw_permits"("scrape_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_insurances_content_hash_key" ON "ingest"."raw_insurances"("content_hash");

-- CreateIndex
CREATE INDEX "idx_raw_insurance_job" ON "ingest"."raw_insurances"("scrape_job_id");

-- AddForeignKey
ALTER TABLE "ingest"."job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest"."raw_challans" ADD CONSTRAINT "raw_challans_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest"."raw_permits" ADD CONSTRAINT "raw_permits_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest"."raw_insurances" ADD CONSTRAINT "raw_insurances_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
