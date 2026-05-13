-- Persist terminal BullMQ-style failures for ops (`system.failed_jobs`).

CREATE TABLE "system"."failed_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queue_name" TEXT NOT NULL,
    "job_name" TEXT,
    "bull_job_id" TEXT,
    "correlation_id" TEXT,
    "scrape_job_id" UUID,
    "payload" JSONB,
    "error_message" TEXT NOT NULL,
    "error_stack" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_failed_jobs_queue_created" ON "system"."failed_jobs"("queue_name", "created_at" DESC);

CREATE INDEX "idx_failed_jobs_created" ON "system"."failed_jobs"("created_at" DESC);
