-- §6 spatial predicate fix: dedicated district_key column on raw_khanan_records
-- avoids full JSON-blob scan for district-based analytics queries.
-- Backfill: run UPDATE ingest.raw_khanan_records SET district_key = payload->'district'::text WHERE district_key IS NULL AND payload ? 'district';

ALTER TABLE "ingest"."raw_khanan_records"
  ADD COLUMN IF NOT EXISTS "district_key" TEXT;

CREATE INDEX IF NOT EXISTS "idx_raw_khanan_district_captured"
  ON "ingest"."raw_khanan_records" ("district_key", "captured_at" DESC);
