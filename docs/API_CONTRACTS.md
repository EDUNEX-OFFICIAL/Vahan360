# API contracts (repo snapshot)

Short reference for HTTP surfaces: **Express** stable `v1` control plane (JWT + optional httpOnly cookie session) and **Nest** guarded control-plane **`/api/v2/*`** when proxied (`pathRewrite` strips `/api/v2`). Nest listens internally with **no** global `/api` prefix (`apps/api-nest/src/main.ts`). Unless noted otherwise, Nest routes require **JWT**: global `JwtAuthGuard` → `DISABLE_AUTH=true` skips for local dev (`apps/api-nest/src/app.module.ts`).

---

## Express `v1` — scrape jobs, workers, queues, metrics, admin

Base URL is typically the Express service. Unless noted, routes accept **httpOnly cookie** `spybot_access` (preferred) **or** Bearer when permitted (`AUTH_ALLOW_BEARER`).

| Method | Path | Auth / gates |
| --- | --- | --- |
| **POST** | `/api/v1/scrape-jobs` | JWT; **`express-rate-limit`** per IP and per username; optional **`Idempotency-Key`**; optional BullMQ **`priority`** 1–10 (`apps/api-express/src/routes/scrapeJobs.js`). |
| **GET** | `/api/v1/scrape-jobs/:id` | JWT |
| **GET** | `/api/v1/scrape-jobs/:id/events` | JWT; `cursor`, `limit` |
| **GET** | `/api/v1/scrape-jobs/:id/stream` | JWT; SSE |
| **GET** | `/api/v1/workers/status` | JWT; optional `limit` |
| **GET** | `/api/v1/queues/metrics` | JWT; optional `limit` |
| **GET** | `/metrics` | No auth when `METRICS_ENABLED=true` (keep private net) |
| **POST** | `/api/v1/admin/queues/retry-replay` | JWT + `ADMIN_QUEUE_REPLAY_ENABLED` + `X-Admin-Token` |
| **GET** | `/admin/queues` | `BULL_BOARD_ENABLED` + JWT + optional IP allowlist |

Public (no JWT): `GET /health`, `GET /api/health/pg`, `POST /api/auth/*`, `POST /auth/*`.

Legacy **`/api/selenium`** sunset — see repo sunset doc; enqueue via **`POST /api/v1/scrape-jobs`**.

---

## Nest `v2` — guarded routes (`/api/v2` externally when proxied)

**Auth model:** Almost every Nest route inherits global **`JwtAuthGuard`** + **`TenantGuard`** (except `@Public()`, e.g. `GET /health`). Many analytics routes add **`RolesGuard`** with **`@Roles('USER', 'ADMIN')`**. Ops/ingest routes require **`ANALYST` / `OPS` / `ADMIN`** as annotated in Swagger / controllers (`apps/api-nest/src/*`.controller.ts). Express proxy forwards `Authorization`, `Cookie`, **`X-Tenant-Id`**, **`X-Org-Id`**, **`X-Org-Path`**, **`X-Parent-Tid`**, tracing, CSRF (`apps/api-express/src/app.js`). JWT optionally carries **`ptid`** (parent tenant slug), **`oid`**, **`opath`** from env-backed bootstrap (`apps/api-express/src/routes/auth.js`); Nest echoes via `/rbac/me` alongside DB roles.

When **`API_V2_PROXY_ENABLED`** is set, external **`/api/v2/<path>`** → internal **`/<path>`**.

### Master route table (`internal path` ≡ proxied `GET/POST … /api/v2/...`)

| Method | Internal Nest path | Roles (short) | Query / notes |
| --- | --- | --- | --- |
| **GET** | `/health` | Public (`@Public()`) | Liveness (`apps/api-nest/src/health.controller.ts`) |
| **GET** | `/rbac/me` | Authenticated JWT | Roles + effective tenant + JWT org hints + derived `permissions[]` (`rbac.controller.ts`) |
| **GET** | `/control/status` | ANALYST, OPS, ADMIN | Process metadata (`control.controller.ts`) |
| **GET** | `/vehicle/:regNorm/summary` | USER, ADMIN | Prisma-backed when ingest DB wired |
| **GET** | `/vehicle/:regNorm/timeline` | USER, ADMIN | `limit`; tenant-filtered ingest events |
| **GET** | `/vehicle/:regNorm/risk` | USER, ADMIN | Weighted scoring |
| **GET** | `/compliance/summary` | USER, ADMIN | **`limit`**, **`district`** (= `vehicleRegNo` substring compat name), **`from`**, **`to`** on `updatedAt` |
| **GET** | `/trips/summary` | USER, ADMIN | **`limit`**, **`from`**, **`to`** on `updatedAt` |
| **GET** | `/consigners/summary` | USER, ADMIN | **`limit`**, **`consignerKey`** substring, **`from`**, **`to`** |
| **GET** | `/districts/summary` | USER, ADMIN | **`limit`**, **`district`** substring, **`from`**, **`to`** |
| **GET** | `/permits/expiring` | USER, ADMIN | **`days`**; **`from`**, **`to`** on `capturedAt` (+ tenant linkage) |
| **GET** | `/insurance/expiring` | USER, ADMIN | same pattern as permits |
| **GET** | `/selectors/health` | ANALYST, OPS, ADMIN | YAML registry only |
| **GET** | `/ingest/raw-khanan` | ANALYST, OPS, ADMIN | **`limit`** (tenant-scope) |
| **GET** | `/ingest/raw-vehicle` | ANALYST, OPS, ADMIN | **`limit`** |
| **GET** | `/ingest/raw-fitness` | ANALYST, OPS, ADMIN | **`limit`** |
| **GET** | `/ingest/raw-challan` | ANALYST, OPS, ADMIN | **`limit`** |
| **GET** | `/ingest/scrape-jobs` | ANALYST, OPS, ADMIN | **`limit`**, **`status`** (exact), **`q`** (substring on kind/status/lastError; full UUID → `id`) |
| **GET** | `/ingest/ops/snapshot` | ANALYST, OPS, ADMIN | Worker + queue snapshots |
| **GET** | `/system/audit-logs` | ANALYST, OPS, ADMIN | **`limit`**, **`action`** filter |
| **GET** | `/system/failed-jobs` | ANALYST, OPS, ADMIN | **`limit`**, **`queueName`**, **`orderBy`** |
| **POST** | `/system/failed-jobs/:id/replay` | OPS, ADMIN | UUID path param |

Missing fine-grained per-permission ACL still — roles + coarse `permissions` strings only (`apps/api-nest/src/auth/rbac.permissions.ts`).

**OpenAPI:** `OPENAPI_ENABLED=true` exposes **`http://nest-host:port/docs`** (not automatically under `/api/v2` rewrite).

---

## Hinglish quick note

Express **JWT / cookie**, Nest **`/api/v2`** ke saath JWT + **`X-Tenant-Id`** / optional org headers aligned hona zaroori hai (proxy forward karta hai). Metrics paths **always private** rakho (`/metrics`).
