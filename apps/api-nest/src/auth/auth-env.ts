/** Shared dev escape hatch: `DISABLE_AUTH=true` skips JWT checks (see `JwtAuthGuard`). */
export function isAuthDisabled(): boolean {
  const v = process.env.DISABLE_AUTH;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * When true, `Authorization: Bearer` is accepted in addition to `spybot_access`.
 * If `AUTH_ALLOW_BEARER` is unset: false in production, true in non-production.
 */
export function isAuthAllowBearer(): boolean {
  const raw = process.env.AUTH_ALLOW_BEARER;
  if (raw != null && String(raw).trim() !== '') {
    const s = String(raw).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }
  return process.env.NODE_ENV !== 'production';
}
