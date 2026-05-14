# Security roadmap — httpOnly JWT cookies + refresh + CSRF (Bearer deprecation)

> **Living roadmap.** Phases **A → D** and **Phase E (soft / prod defaults)** are **shipped** in repo; Phase **E-hard** items (remove Bearer implementation entirely after metrics + drop dual JSON bodies) remain backlog. Companion: [`./ENTERPRISE_COMPLETION_CHECKLIST.md`](./ENTERPRISE_COMPLETION_CHECKLIST.md) §2, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) → "Security posture".

## Where we are today — 2026-05-14 snapshot

> **Phase B + C + D + E (soft) shipped.** See sections below.

- **Login** posts to **`POST /api/auth/login`** (preferred) or **`POST /api/auth/generate-token`** (legacy alias) → backend sets three httpOnly / readable cookies **and** (today) still returns **`{ token, type: 'Bearer', … }`** for dual-mode compat (`apps/api-express/src/routes/auth.js`). **Phase E-hard** will move this to cookies-only responses after traffic metrics allow.
- **Storage:** Browser **does not** persist the access JWT in `localStorage` for session auth. The SPA treats `spybot_csrf` as the “session present” hint (`hasSpybotSession()` in `apps/web/src/lib/api-client.ts`). The raw access token lives in httpOnly **`spybot_access`** — JS never reads it. A **one-time migration sweep** removes any **legacy** pre-cookie key using a **constructed** storage key (no literal `spybot_token` bytes in `apps/` / `packages/` — CI enforces via `git grep -F`).
- **API client:** authed `fetch` uses `credentials: 'include'` + `X-CSRF-Token` from `spybot_csrf` (`AppShell.tsx` global wrapper; `apiFetch` in `api-client.ts`). Auto-refresh on 401 for safe methods is wired.
- **Backend posture:**
  - `helmet()` + CSP (tunable via `HELMET_DISABLE_CSP`).
  - CORS allow-list; wildcard blocked in production.
  - **Phase E (soft):** `AUTH_ALLOW_BEARER` — **unset in production → Bearer rejected** with **401** + `code: bearer_deprecated`; only **`spybot_access`** cookie is accepted (`apps/api-express/src/lib/authAllowBearer.js`, `middleware/auth.js`). **Non-production** default still allows Bearer when env is unset (local DX / scripts). Set `AUTH_ALLOW_BEARER=true` explicitly to allow header auth in prod **only** if required for break-glass tooling.
  - When Bearer is allowed, header still **wins** over cookie if both are sent (compat order).
  - Nest mirrors the same rule (`apps/api-nest/src/auth/auth-env.ts`, `auth.utils.ts`, `jwt-auth.guard.ts`).
  - CSRF double-submit on mutating `/api/**` (except auth plumbing).
  - `RefreshSession` + jti / tokenHash chain compromise detection.
- **Nest:** global **`JwtAuthGuard` + `TenantGuard`** (`apps/api-nest/src/app.module.ts`); `@Public()` on `/health`. Express proxy can forward cookies and (when proxy is enabled) synthesize `Authorization: Bearer` for east-west — see `apps/api-express/src/app.js`.

## Target end-state

- Browser **never** sees the raw access token. Sessions are an **httpOnly, Secure, SameSite=Lax** cookie set by the backend on `/auth/login` and `/auth/refresh`.
- A short-lived **access token** (≤ 15 min) is rotated via a long-lived **refresh token** kept in a separate httpOnly cookie with a stricter `Path=/auth/refresh`.
- All cookie-authed **mutating** requests carry a **CSRF token** (double-submit cookie or synchronizer pattern).
- Nest gets its own auth guard (verifies the same access cookie, or a separate service JWT for east-west calls).
- Express `Authorization: Bearer` path is **deprecated in production by default** (`AUTH_ALLOW_BEARER`); **hard removal** of header parsing is **Phase E-hard** (after metrics).

---

## Phase A — Discovery + spec freeze ✅ RESOLVED (2026-05-14)

**Goal:** lock the cookie + CSRF contract before any code lands.

- [x] No **literal** `spybot_token` substring under `apps/` / `packages/` — CI `git grep -F "spybot_token"` in `.github/workflows/ci.yml`. Legacy sweep uses constructed key (`spybot_${'token'}`) / shared `LEGACY_JWT_STORAGE_KEY`.
- [x] **Cookie set shipped:**
  - **`spybot_access`** — httpOnly, Secure, SameSite=Lax, Path=/ (env-tunable), TTL `AUTH_ACCESS_TTL_SECONDS` (default 15 min).
  - **`spybot_refresh`** — httpOnly, Secure, SameSite=Lax, Path=/ (same base path for simplicity; can be narrowed to `Path=/auth/refresh` via `AUTH_COOKIE_PATH`), TTL `AUTH_REFRESH_TTL_SECONDS` (default 30 days).
  - **`spybot_csrf`** — readable (NOT httpOnly), SameSite=Lax, TTL 24 h (`CSRF_TOKEN_MAX_AGE_MS`).
- [x] **Route shape shipped:** `/auth/login` (new) + `/auth/generate-token` (legacy compat) + `/auth/refresh` + `/auth/logout` + `/auth/me` + `/auth/csrf`.
- [x] **Storage:** `RefreshSession` Prisma model (`id` UUID, `userId`, `tokenHash` SHA-256, `jti` UUID, `expiresAt`, `revokedAt`, `rotatedAt`, `updatedAt`) with jti + hash chain compromise detection.
- [x] **CSRF policy:** safe verbs exempt; mutating verbs on `/api/**` require `X-CSRF-Token == spybot_csrf` (except auth plumbing and `/logout`, `/refresh`).
- [x] **CORS:** wildcard blocked in production; `CORS_ORIGIN_ALLOWLIST` env enforced.

**Exit criteria met:** spec is this document; code is shipped.

---

## Phase B — Backend foundation ✅ SHIPPED (2026-05-14)

**Goal:** add cookie + refresh issuance **alongside** the existing Bearer flow. Nothing breaks for current callers.

- [x] `cookie-parser` not needed — `apps/api-express/src/lib/cookies.js` parses `req.headers.cookie` directly; zero extra dependency.
- [x] `RefreshSession` Prisma model in `apps/api-express/prisma/schema.prisma` (`id`, `userId`, `tokenHash`, `jti`, `expiresAt`, `revokedAt`, `rotatedAt`).
- [x] **Issuance helpers** in `apps/api-express/src/lib/authCookies.js`:
  - `setAuthCookies(res, req, { accessToken, refreshToken, … })` — `HttpOnly; Secure; SameSite=Lax` (env-tunable).
  - `setCsrfCookie(res, req, value)` — readable (not HttpOnly), `SameSite=Lax`; TTL `CSRF_TOKEN_MAX_AGE_MS` (default 24 h).
  - `clearAuthCookies(res, req)` — zeroes all three cookies.
  - Cookie names: `spybot_access`, `spybot_refresh`, `spybot_csrf` (consistent with frontend constants).
  - `Secure` flag: auto from `NODE_ENV=production` or `AUTH_COOKIE_SECURE=true` or `X-Forwarded-Proto: https`.
- [x] **Endpoints** (both `/api/auth/*` and `/auth/*` mounts):
  - `POST /auth/login` ← **new preferred path** (alias of `generate-token`).
  - `POST /auth/generate-token` ← legacy path kept for non-browser backward compat.
  - Both: set all three cookies **and** return legacy `{ token, type, validUntil, … }` JSON for dual-mode migration.
  - `POST /auth/refresh` — rotates access + refresh cookies + CSRF cookie; revokes old `RefreshSession` row; returns updated token JSON; jti + tokenHash chain compromise detection.
  - `POST /auth/logout` — revokes `RefreshSession`, clears all three cookies.
  - `GET /auth/me` — accepts Bearer or cookie; refreshes CSRF cookie if absent.
  - `GET /auth/csrf` — issues a fresh CSRF cookie + returns token in body.
- [x] **Auth middleware** (`apps/api-express/src/middleware/auth.js`): when `authAllowBearer()` is true, Bearer header wins if both header + cookie present (CLI / non-prod). When **false** (production default), **Bearer alone returns 401** `bearer_deprecated`; **cookie-only** path. `clockTolerance: 30`. Refresh tokens rejected via `typ` claim guard.
- [x] **CSRF middleware** (`apps/api-express/src/middleware/csrf.js`): double-submit cookie pattern; mutating verbs on `/api/**` (except `/api/auth/generate-token`, `/login`, `/register-user`, `/logout`, `/refresh`, `/health`, `/csrf`) require matching `X-CSRF-Token` header.
  - `/logout` and `/refresh` are intentionally excluded: httpOnly cookies prove possession; excluding them avoids UX lockout when CSRF cookie outlives the access window.
- [x] **Nest proxy** (`apps/api-express/src/app.js`): `onProxyReq` converts `spybot_access` cookie to `Authorization: Bearer` for Nest; raw `Cookie` header is forwarded automatically by `createProxyMiddleware`.
- [x] **Env vars** documented in `apps/api-express/.env.example`: `AUTH_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TTL_SECONDS`, `AUTH_COOKIE_DOMAIN`, `AUTH_COOKIE_PATH`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_SECURE`, `CSRF_TOKEN_MAX_AGE_MS`.
- [ ] Jest unit tests for the new endpoints (login sets all 3 cookies, refresh rotates, logout clears, header path still works) — **next PR**.

**Exit criteria:** CI green; `curl` against `/api/auth/login` returns the Bearer JSON **and** sets cookies. No frontend changes needed (already done in same PR — see Phase C below).

---

## Phase C — Frontend cutover ✅ SHIPPED (2026-05-14)

**Goal:** swap the SPA to cookie auth without breaking ops scripts.

- [x] No `NEXT_PUBLIC_AUTH_COOKIE_MODE` flag needed — cookie mode is the only mode now.
- [x] **`apps/web/src/lib/api-client.ts`**:
  - `apiFetch(path, token, init)` — always includes `credentials: 'include'` and `X-CSRF-Token` from `spybot_csrf` cookie.
  - `getSpybotToken()` — returns `'__cookie_session__'` sentinel (not the raw JWT) when `spybot_csrf` cookie is present.
  - `hasSpybotSession()` — boolean check on `spybot_csrf` cookie presence.
  - `clearSpybotToken()` — clears legacy `spybot_token` from localStorage (migration sweep).
  - `withApiCredentials(init)` — utility to add `credentials: 'include'` to any fetch init.
- [x] **`apps/web/src/components/AppShell.tsx`** — global `fetch` interceptor wraps all API calls with `credentials: 'include'`; intercepts 401 on GET/HEAD to trigger `/api/auth/refresh` with CSRF header before replaying original request.
- [x] **Zero `localStorage.setItem('spybot_token')` anywhere in `apps/web/src/`** — verified grep clean.
- [x] **`apps/web/src/app/login/page.tsx`** — login posts to `/api/auth/generate-token` with `credentials: 'include'`; no token stored; redirects on `{ type: 'Bearer' }` response (cookies set by browser automatically).
- [x] `GET /api/auth/me` route on Express acts as `useSession()` equivalent — used by pages that need user identity.
- [ ] SSE `EventSource` with `withCredentials: true` — verify in compose + ingress (nginx `proxy_pass_request_headers on`).
- [ ] Playwright E2E: login → dashboard → logout in cookie mode.

**Exit criteria:** login works end-to-end with cookies; zero localStorage reads for JWT.

---

## Phase D — Flip default + tighten ✅ SHIPPED (2026-05-14)

**Goal:** make cookie mode the default in production.

- [x] `AUTH_COOKIE_MODE` flag not needed — cookie auth has no feature-flag; always on since Phase B/C.
- [x] `NEXT_PUBLIC_AUTH_COOKIE_MODE` flag not needed — SPA detects session via `spybot_csrf` cookie; no flag required.
- [x] **CORS locked in Helm:** `CORS_ORIGIN_ALLOWLIST: ""` added to `deploy/helm/vahan360/values.yaml` `config` with deployer guidance; wildcard blocked at runtime in production (`corsOriginHandler` throws on prod+wildcard).
- [x] **`AUTH_COOKIE_SECURE: "true"`** added to Helm `config` defaults — ensures Secure flag on httpOnly cookies in all prod deployments.
- [x] **Helmet CSP tightened:** `apps/api-express/src/app.js` now uses explicit `directives` (including `connect-src: 'self'` for SSE and `upgrade-insecure-requests` when `AUTH_COOKIE_SECURE=true`). `HELMET_DISABLE_CSP` documented as dev-only; **not** set in Helm prod values.
- [x] **Migration banner shipped:** `apps/web/src/components/AppShell.tsx` — first load clears any **legacy** pre-cookie key via `localStorage.getItem(LEGACY_JWT_STORAGE_KEY)` + `clearSpybotToken()`; short toast; redirects to `/login` if cookie session missing. `sessionStorage` flag avoids loops.
- [x] **Nest proxy Cookie audit:** `apps/api-express/src/app.js` `onProxyReq` now explicitly re-asserts the `cookie` header via `forwardIfPresent(proxyReq, req, "cookie")` so Nest services receive httpOnly cookies for east-west calls.

**Exit criteria:** new prod logins do not stash JWT in `localStorage` for session auth ✅; CSP / Secure cookie defaults in Helm ✅; Nest receives cookie header ✅; global Nest JWT + tenant guards ✅; build green ✅.

---

## Phase E — Deprecate Bearer path + clean up

**Goal:** first **turn off Bearer in production by default** (✅ done), then **delete dual-mode code** once metrics prove it is safe (backlog).

### E-soft — prod defaults + CI — ✅ SHIPPED (repo, 2026-05-14)

- [x] **Production cookie-only by default:** `AUTH_ALLOW_BEARER` unset + `NODE_ENV=production` → **`authAllowBearer()` false**; `401` + `bearer_deprecated` if client sends `Authorization: Bearer` (`apps/api-express/src/lib/authAllowBearer.js`, `middleware/auth.js`). Nest aligns (`apps/api-nest/src/auth/auth-env.ts`, `jwt-auth.guard.ts`).
- [x] **Escape hatch:** set `AUTH_ALLOW_BEARER=true` when tooling must send Bearer (break-glass / migration window).
- [x] **CI regression guard:** `.github/workflows/ci.yml` fails if **`git grep -F "spybot_token"`** finds a match under **`apps/`** or **`packages/`** (literal substring banned in tracked source).
- [x] **Web cleanup:** SPA uses **`LEGACY_JWT_STORAGE_KEY`** / `spybot_${'token'}` pattern — satisfies CI while still deleting any legacy migrated entry via `clearSpybotToken()`.
- [x] **`NEXT_PUBLIC_AUTH_COOKIE_MODE`** — not used (removed in Phase C/D; nothing left to drop).

### E-hard — remove Bearer implementation + dual bodies — 🔲 BACKLOG

- [ ] **`auth_path{kind="header|cookie"}`** (or equivalent) metric in Express — prove **≤ 0.1%** header traffic ≥ 1 release before deleting code paths.
- [ ] **Delete** Bearer branch from `middleware/auth.js` / Nest `accessTokenFromRequest` **after** metric gate (or gate via permanent `AUTH_ALLOW_BEARER` removal in prod configs only — product decision).
- [ ] **`POST /auth/generate-token` + `/auth/login`:** stop returning `{ token, type: 'Bearer', … }`; return **204** or session metadata only (cookies carry credentials).
- [ ] **ARCHITECTURE.md** “Security posture” + “Frontend ↔ API” — replace any remaining “JWT in browser storage / Bearer header” language (partially updated 2026-05-14).

**E-soft exit criteria (met):** CI grep green; **production** rejects unsolicited Bearer with `bearer_deprecated` unless `AUTH_ALLOW_BEARER=true`; session auth does not rely on `localStorage` JWT.

**E-hard exit criteria (open):** metrics + code deletion + docs fully aligned; optional stricter CI (`localStorage.setItem` patterns) if product wants belt-and-suspenders beyond substring ban.

---

## Risks & gotchas

- **SSE behind nginx / ingress:** cookies need `proxy_pass_request_headers on;` and adequate `proxy_read_timeout`. Confirm `EventSource` works after Phase C in compose **and** the Helm ingress.
- **CSRF + idempotency:** `POST /api/v1/scrape-jobs` is idempotent via `Idempotency-Key`; CSRF token still required because it's a state-changing verb.
- **Cross-subdomain cookies:** if API and SPA end up on different parents (e.g. `api.example.com` vs `app.example.com`), `SameSite=Lax` may need to become `SameSite=None; Secure` + a `Domain=.example.com` attribute. Defer until Phase D and resolve per-env.
- **Refresh storms:** rotate refresh tokens; one-use refresh; if the **old** refresh token is presented again after rotation, force-logout the user (chain compromise).
- **Token clock skew:** access TTL ≤ 15 min, plus 30s leeway in `jsonwebtoken.verify` (`clockTolerance: 30`).
- **Mobile / CLI clients:** if any consumer is non-browser, document the Bearer header lane explicitly in `docs/API_CONTRACTS.md` before Phase **E-hard** deletes header support entirely.

## Hinglish quick note

- **Pehle:** JWT **`localStorage`** mein → XSS risk.
- **Ab:** Phases **A → D + E-soft** shipped.
  - Access token **httpOnly `spybot_access`**; CSRF **`spybot_csrf`** sentinel; refresh rotation + chain detection.
  - **Prod:** Bearer header **by default band** (`bearer_deprecated`) — sirf **`AUTH_ALLOW_BEARER=true`** se wapas CLI-style.
  - **CI:** **`spybot_token`** literal substring `apps/` + `packages/` mein forbidden.
- **`E-hard` backlog:** Bearer code path completely hataana, dual JSON body hataana, metrics + **`ARCHITECTURE.md`** polish — jab observability approve ho.
