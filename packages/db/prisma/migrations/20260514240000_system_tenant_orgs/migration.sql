-- §3 org FK graph: system.tenant_orgs links tenant slugs → org path tree.
-- Enables TenantGuard to validate JWT `tid`/`ptid`/`oid` claims against a DB-backed org membership table.
-- Seeded via ops script; JWT bootstrap (ptid/opath) still works without rows (graceful fallback).

CREATE TABLE IF NOT EXISTS "system"."tenant_orgs" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_slug"  TEXT         NOT NULL,
  "org_id"       TEXT         NOT NULL,
  "org_path"     TEXT         NOT NULL,
  "label"        TEXT,
  "active"       BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_orgs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_orgs_tenant_slug_key" UNIQUE ("tenant_slug")
);

CREATE INDEX IF NOT EXISTS "idx_tenant_orgs_org_id"   ON "system"."tenant_orgs" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_orgs_org_path" ON "system"."tenant_orgs" ("org_path");

COMMENT ON TABLE "system"."tenant_orgs" IS 'Org FK graph: maps tenant slugs to org / org-path nodes for DB-backed TenantGuard ACL.';
