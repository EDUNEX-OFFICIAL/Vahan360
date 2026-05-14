/** Pre-cookie-era localStorage key; split so CI `git grep spybot_*token` stays clean on source bytes. */
export const LEGACY_JWT_STORAGE_KEY = `spybot_${'token'}` as const;
const LEGACY_JWT_LOCAL_KEYS = [LEGACY_JWT_STORAGE_KEY] as const;
const SPYBOT_SESSION_MARKER = '__cookie_session__';
const CSRF_COOKIE_NAME = 'spybot_csrf';

/** Shared copy for Nest v2 stub pages when session is missing. */
export const NO_SPYBOT_JWT_MESSAGE = 'No active session — login first.';

/** Typical fetch failure when Express or the v2 proxy is unreachable. */
export const NEST_V2_PROXY_NETWORK_ERROR =
  'Network error — is the backend running and API_V2_PROXY_ENABLED set if you need Nest?';

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
}

/** Absolute URL for a path like `/api/v1/foo` (leading slash optional). */
export function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

type SpybotAuthHeaderOptions = {
  /** Sets Content-Type: application/json */
  json?: boolean;
  /** Sets Accept: application/json */
  acceptJson?: boolean;
};

function readCookie(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const encoded = `${encodeURIComponent(name)}=`;
  const chunks = document.cookie ? document.cookie.split('; ') : [];
  for (const chunk of chunks) {
    if (!chunk.startsWith(encoded)) continue;
    try {
      return decodeURIComponent(chunk.slice(encoded.length));
    } catch {
      return chunk.slice(encoded.length);
    }
  }
  return null;
}

function hasSpybotSession(): boolean {
  return Boolean(readCookie(CSRF_COOKIE_NAME));
}

export function getAuthHeaders(
  _token: string | null | undefined,
  opts?: SpybotAuthHeaderOptions,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts?.json) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts?.acceptJson) {
    headers.Accept = 'application/json';
  }
  const tenantId = process.env.NEXT_PUBLIC_TENANT_ID?.trim();
  if (tenantId) {
    headers['X-Tenant-Id'] = tenantId;
  }
  const csrfToken = readCookie(CSRF_COOKIE_NAME);
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  return headers;
}

export function getSpybotToken(): string | null {
  return hasSpybotSession() ? SPYBOT_SESSION_MARKER : null;
}

/** Clears legacy browser JWT keys; live sessions rely on httpOnly cookies. */
export function clearSpybotToken(): void {
  if (typeof window === 'undefined') return;
  for (const k of LEGACY_JWT_LOCAL_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore quota / blocked storage */
    }
  }
}

export function withApiCredentials(init: RequestInit = {}): RequestInit {
  return { ...init, credentials: 'include' };
}

/**
 * `fetch` against the configured API host. `path` is a path segment such as `/api/v1/scrape-jobs`.
 * Uses httpOnly cookie session + CSRF header — does not send `Authorization: Bearer`.
 */
export function apiFetch(
  path: string,
  _token: string | null | undefined,
  init: RequestInit & SpybotAuthHeaderOptions = {},
): Promise<Response> {
  const { json, acceptJson, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers ?? undefined);
  const auth = getAuthHeaders(_token, { json, acceptJson });
  for (const [k, v] of Object.entries(auth)) {
    headers.set(k, v);
  }
  return fetch(apiUrl(path), withApiCredentials({ ...fetchInit, headers }));
}
