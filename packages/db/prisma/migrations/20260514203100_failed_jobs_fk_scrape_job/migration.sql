-- Optional FK so Prisma can relate system.failed_jobs → ingest.scrape_jobs for tenant filtering.
ALTER TABLE "system"."failed_jobs"
  DROP CONSTRAINT IF EXISTS "failed_jobs_scrape_job_id_fkey";

ALTER TABLE "system"."failed_jobs"
  ADD CONSTRAINT "failed_jobs_scrape_job_id_fkey"
  FOREIGN KEY ("scrape_job_id") REFERENCES "ingest"."scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
