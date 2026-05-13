export function resolvedDefaultTenantSlug(): string {
  const raw = process.env.DEFAULT_TENANT_ID?.trim();
  return raw && raw.length > 0 ? raw : 'default';
}

/** When set, only these slugs may be used as effective tenant (comma-separated). */
export function parseTenantAllowlist(): Set<string> | null {
  const raw = process.env.ALLOWED_TENANT_IDS?.trim();
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return new Set(parts);
}
