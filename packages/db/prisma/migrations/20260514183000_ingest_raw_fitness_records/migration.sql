-- Raw fitness / validity captures (ingest layer).

CREATE TABLE "ingest"."raw_fitness_records" (
    "id" BIGSERIAL NOT NULL,
    "scrape_job_id" UUID,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_url" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_fitness_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "raw_fitness_records_content_hash_key" ON "ingest"."raw_fitness_records"("content_hash");

CREATE INDEX "idx_raw_fitness_job" ON "ingest"."raw_fitness_records"("scrape_job_id");

CREATE INDEX "idx_raw_fitness_captured" ON "ingest"."raw_fitness_records"("captured_at" DESC);

ALTER TABLE "ingest"."raw_fitness_records" ADD CONSTRAINT "raw_fitness_records_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
