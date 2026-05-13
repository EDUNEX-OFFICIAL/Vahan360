-- Migrate public.users.roles from free-form TEXT to TEXT[] (Prisma String[]).
-- Legacy values were comma-separated role slugs; empty/null becomes {USER}.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles_new" TEXT[];

UPDATE "users" SET "roles_new" = COALESCE(
  (
    SELECT array_agg(upper(trim(t)))
    FROM unnest(string_to_array(COALESCE("roles", ''), ',')) AS u(t)
    WHERE trim(t) <> ''
  ),
  ARRAY[]::TEXT[]
);

UPDATE "users" SET "roles_new" = ARRAY['USER']::TEXT[]
WHERE "roles_new" IS NULL OR cardinality("roles_new") = 0;

ALTER TABLE "users" DROP COLUMN "roles";
ALTER TABLE "users" RENAME COLUMN "roles_new" TO "roles";
ALTER TABLE "users" ALTER COLUMN "roles" SET DEFAULT ARRAY['USER']::TEXT[];
ALTER TABLE "users" ALTER COLUMN "roles" SET NOT NULL;
