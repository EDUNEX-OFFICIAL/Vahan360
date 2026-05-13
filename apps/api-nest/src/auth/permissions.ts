/**
 * @deprecated Use `rbac.permissions.ts`; re-exports retained for intra-package imports stability.
 */
export {
  normalizeRolesFromDb as parseCommaRoles,
  normalizeRolesFromDb,
  permissionsFromNormalizedRoles as permissionsFromRoles,
  permissionsFromNormalizedRoles,
  userHasRole,
  ROLE_SLUGS,
  RBAC_KNOWN_ROLE_SLUGS,
  DEFAULT_ROLE_SLUG,
  type KnownRoleSlug,
  type RoleSlug,
} from './rbac.permissions';
