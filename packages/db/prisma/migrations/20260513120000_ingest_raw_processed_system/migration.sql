-- Extend ingest with additional raw capture tables; add `processed` + `system` schemas for stubs / ops.

CREATE SCHEMA IF NOT EXISTS "processed";
CREATE SCHEMA IF NOT EXISTS "system";

-- CreateTable
CREATE TABLE "ingest"."raw_khanan_records" (
    "id" BIGSERIAL NOT NULL,
    "scrape_job_id" UUID,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_url" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_khanan_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest"."raw_vehicle_records" (
    "id" BIGSERIAL NOT NULL,
    "scrape_job_id" UUID,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_url" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_vehicle_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed"."vehicle_trip_summary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_reg_no" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_trip_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed"."vehicle_compliance_summary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_reg_no" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_compliance_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed"."consigner_summary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consigner_key" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consigner_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed"."district_summary" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "district" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "district_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system"."audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system"."worker_status" (
    "worker_id" TEXT NOT NULL,
    "queue_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "last_heartbeat" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,

    CONSTRAINT "worker_status_pkey" PRIMARY KEY ("worker_id")
);

-- CreateTable
CREATE TABLE "system"."queue_metrics" (
    "id" BIGSERIAL NOT NULL,
    "queue_name" TEXT NOT NULL,
    "sample" JSONB NOT NULL DEFAULT '{}',
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_khanan_records_content_hash_key" ON "ingest"."raw_khanan_records"("content_hash");

-- CreateIndex
CREATE INDEX "idx_raw_khanan_job" ON "ingest"."raw_khanan_records"("scrape_job_id");

-- CreateIndex
CREATE INDEX "idx_raw_khanan_captured" ON "ingest"."raw_khanan_records"("captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "raw_vehicle_records_content_hash_key" ON "ingest"."raw_vehicle_records"("content_hash");

-- CreateIndex
CREATE INDEX "idx_raw_vehicle_job" ON "ingest"."raw_vehicle_records"("scrape_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_trip_summary_vehicle_reg_no_key" ON "processed"."vehicle_trip_summary"("vehicle_reg_no");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_compliance_summary_vehicle_reg_no_key" ON "processed"."vehicle_compliance_summary"("vehicle_reg_no");

-- CreateIndex
CREATE UNIQUE INDEX "consigner_summary_consigner_key_key" ON "processed"."consigner_summary"("consigner_key");

-- CreateIndex
CREATE UNIQUE INDEX "district_summary_district_key" ON "processed"."district_summary"("district");

-- CreateIndex
CREATE INDEX "idx_audit_logs_created" ON "system"."audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_queue_metrics_name_time" ON "system"."queue_metrics"("queue_name", "recorded_at" DESC);

-- AddForeignKey
ALTER TABLE "ingest"."raw_khanan_records" ADD CONSTRAINT "raw_khanan_records_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest"."raw_vehicle_records" ADD CONSTRAINT "raw_vehicle_records_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
