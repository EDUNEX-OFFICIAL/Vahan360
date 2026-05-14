import type { RoleSlug } from './rbac.permissions';

export type NestJwtUser = {
  username: string;
  roles: RoleSlug[];
  /** `tid` claim from the access JWT (Express-issued). */
  jwtTenantId: string | null;
  /** Parent tenant slug when `ptid` claim present (JWT-only org hierarchy bootstrap). */
  jwtParentTenantId: string | null;
  /** Optional org id/path from JWT (`oid` / `opath`) until DB-backed hierarchy lands. */
  jwtOrgId: string | null;
  jwtOrgPath: string | null;
  /** `public.users.tenant_id` when present — locks user to this slug. */
  dbTenantId: string | null;
};

export type AccessJwtPayload = {
  v?: number;
  typ?: string;
  tid?: string | number;
  /** Parent tenant slug (distinct from tenant `tid` when using env/bootstrap claims). */
  ptid?: string | number;
  /** Logical org identifier (JWT-only). */
  oid?: string | number;
  /** Logical org hierarchy path (`parent/child`). */
  opath?: string | number;
};