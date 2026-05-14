import type { Prisma } from '@vahan360/db';

const INGEST_DEFAULT_TENANT_SLUG = 'default';

type TenantScopedJobFilter = Prisma.ScrapeJobWhereInput;

/** Normalize slug; empty becomes `default`. */
export function normalizeTenantSlug(raw: string | undefined | null): string {
  const s = raw != null ? String(raw).trim() : '';
  return s.length > 0 ? s : INGEST_DEFAULT_TENANT_SLUG;
}

/**
 * Raw ingest rows (`scrape_job_id` FK): tenant is enforced via related `ScrapeJob.tenant_id`.
 * Rows with null `scrape_job_id` are legacy/shared and visible only for the default tenant.
 */
export function rawRowsLinkedToJobTenantWhere(tenantId: string): Prisma.RawChallanWhereInput {
  const t = normalizeTenantSlug(tenantId);
  if (t === INGEST_DEFAULT_TENANT_SLUG) {
    return {
      OR: [{ scrapeJobId: null }, { job: { tenantId: INGEST_DEFAULT_TENANT_SLUG } }],
    };
  }
  return { job: { tenantId: t } };
}

export function scrapeJobTenantWhere(tenantId: string): TenantScopedJobFilter {
  return { tenantId: normalizeTenantSlug(tenantId) };
}

export function jobEventTenantWhere(tenantId: string): Prisma.JobEventWhereInput {
  const t = normalizeTenantSlug(tenantId);
  return { job: { tenantId: t } };
}

export function failedJobTenantWhere(tenantId: string): Prisma.FailedJobWhereInput {
  const t = normalizeTenantSlug(tenantId);
  if (t === INGEST_DEFAULT_TENANT_SLUG) {
    return {
      OR: [
        { scrapeJobId: null },
        { scrapeJob: { tenantId: INGEST_DEFAULT_TENANT_SLUG } },
      ],
    };
  }
  return { scrapeJob: { tenantId: t } };
}
