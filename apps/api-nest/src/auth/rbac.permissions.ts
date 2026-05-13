import type { NestJwtUser } from './auth.types';

/** Canonical role slugs (Express `users.roles` is Postgres `text[]`; legacy CSV still accepted in normalizer). */
const ROLE_SLUGS = ['ADMIN', 'ANALYST', 'OPS', 'USER'] as const;

export type KnownRoleSlug = (typeof ROLE_SLUGS)[number];

/** Slug preserved from DB/JWT (`CUSTOM_ROLE` uppercase). Permissions map only for known roles. */
export type RoleSlug = KnownRoleSlug | (string & { readonly __brand?: never });

/** Default when `roles` column is blank (no magic comma-string defaults at call sites). */
const DEFAULT_ROLE_SLUG: KnownRoleSlug = 'USER';

const ADMIN_PERMISSIONS = [
  '*',
  'ingest:*',
  'system:*',
  'vehicle:*',
  'scrape:*',
  'queue:replay',
  'audit:read',
] as const;

const OPS_PERMISSIONS = [
  'ingest:*',
  'system:*',
  'scrape:*',
  'vehicle:read',
  'analytics:read',
  'audit:read',
  'queue:replay',
  'selector:read',
] as const;

const ANALYST_PERMISSIONS = [
  'scrape:read',
  'vehicle:read',
  'ingest:read',
  'analytics:read',
  'audit:read',
  'selector:read',
  'system:read',
] as const;

const USER_PERMISSIONS = ['scrape:read', 'vehicle:read', 'ingest:read'] as const;

const KNOWN = new Set<string>(ROLE_SLUGS);

/** Normalize DB `roles` (Postgres `text[]`, legacy comma-string, or null) → slug array. */
export function normalizeRolesFromDb(raw: string | string[] | null | undefined): RoleSlug[] {
  if (raw == null) {
    return [DEFAULT_ROLE_SLUG];
  }
  if (Array.isArray(raw)) {
    const out = raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    return (out.length > 0 ? out : [DEFAULT_ROLE_SLUG]) as RoleSlug[];
  }
  const s = String(raw).trim();
  if (s === '') {
    return [DEFAULT_ROLE_SLUG];
  }
  const out: RoleSlug[] = [];
  for (const part of s.split(',')) {
    const t = part.trim().toUpperCase();
    if (t === '') continue;
    out.push(t as RoleSlug);
  }
  return out.length > 0 ? out : [DEFAULT_ROLE_SLUG];
}

/** Unified permission hints for `/rbac/me` derived only from typed role buckets (additive merge). */
export function permissionsFromNormalizedRoles(roleList: readonly RoleSlug[]): string[] {
  let set = new Set<string>();

  const upper = roleList.map((r) => String(r).trim().toUpperCase());
  if (upper.some((r) => r === 'ADMIN')) {
    set = new Set<string>(ADMIN_PERMISSIONS);
    return [...set].sort();
  }

  for (const r of upper) {
    if (!KNOWN.has(r)) {
      for (const p of USER_PERMISSIONS) set.add(p);
      continue;
    }
    switch (r) {
      case 'OPS':
        for (const p of OPS_PERMISSIONS) set.add(p);
        break;
      case 'ANALYST':
        for (const p of ANALYST_PERMISSIONS) set.add(p);
        break;
      case 'USER':
        for (const p of USER_PERMISSIONS) set.add(p);
        break;
      default:
        break;
    }
  }
  return [...set].sort();
}

/** JWT-only org / tenant bootstrap echo — not a persisted org directory. */
type JwtOrgEcho = {
  source: 'jwt_bootstrap';
  tenantId: string | null;
  parentTenantId: string | null;
  orgId: string | null;
  orgPath: string | null;
};

export function orgEchoFromJwt(user: NestJwtUser): JwtOrgEcho[] {
  return [
    {
      source: 'jwt_bootstrap',
      tenantId: user.jwtTenantId,
      parentTenantId: user.jwtParentTenantId,
      orgId: user.jwtOrgId,
      orgPath: user.jwtOrgPath,
    },
  ];
}

type PermissionDetailRow = {
  permission: string;
  grantedVia: 'role_derivation';
};

/** Structured permission rows — always derived from `permissionsFromNormalizedRoles` (no DB ACL table). */
export function permissionsDetailedFromRoles(roleList: readonly RoleSlug[]): {
  aclBacked: false;
  model: 'coarse_role_buckets';
  note: 'Effective permissions are synthesized from role slugs in rbac.permissions.ts only.';
  items: PermissionDetailRow[];
} {
  const items = permissionsFromNormalizedRoles(roleList).map((permission) => ({
    permission,
    grantedVia: 'role_derivation' as const,
  }));
  return {
    aclBacked: false,
    model: 'coarse_role_buckets',
    note: 'Effective permissions are synthesized from role slugs in rbac.permissions.ts only.',
    items,
  };
}

export function userHasRole(user: NestJwtUser, ...required: string[]): boolean {
  const rs = new Set(user.roles.map((r) => String(r).trim().toUpperCase()));
  for (const need of required) {
    if (rs.has(String(need).trim().toUpperCase())) return true;
  }
  return false;
}
