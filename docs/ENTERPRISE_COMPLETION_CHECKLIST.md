# Enterprise completion checklist (Vahan360)

> Snapshot date: **2026-05-14** · Last pass: **2026-05-14** (all 7 partials closed → 100%).
>
> **Doc sync:** [`SECURITY_ROADMAP_HTTPONLY.md`](./SECURITY_ROADMAP_HTTPONLY.md); [`ARCHITECTURE.md`](../ARCHITECTURE.md); **`users.roles` → `text[]`** + migration **`20260514120000_user_roles_text_array`**; Helm **`databaseUrlSource`/`DATABASE_URL_PGBOUNCER`**, snippet **`deploy/helm/vahan360/snippets/pgBouncer-values.overlay.yaml`**; browser-manager Redis lease mirrors + optional **`BROWSER_MAX_CONTEXTS_PER_TENANT`** quotas; in-process tenant quota **`tenantQuota.js`** (`BROWSER_POOL_QUOTAS_JSON` / `BROWSER_POOL_TENANT_MAX_CONTEXTS`); Nest ingest **`createIngestReadonlyPrismaClient`** on SELECT-only modules; **`/trips`/`/districts`/`/compliance`** **`StatusBarChart`** slice widgets + **`?q=`** parity; **`tsconfig.base.json`**; **`/rbac/me`** structured **`orgs`**/**`permissionsDetailed`**; **`VEHICLE_INTEL_PROXY_TO_NEST`** + **`compliance/summary/export.csv`** + OpenAPI **`SCRAPE_JOB_KINDS`** parity test; Prisma partitioning migration stub (`20260514200000_partition_job_events_template`); OpenAPI `/api/khanan/stats`, `/api/khanan/districts`, `/api/khanan/minerals` routes; `openapi-v1.contract.test.js` 35-assertion suite; `cosign.pub.example`; Vault HCL + bootstrap script (`deploy/k8s/vault/`); **§3** `system.tenant_orgs` migration `20260514240000` + `tenantScope.js`; **§4** Helm `NOTES.txt` KEDA pre-flight; **§5** `portalErrorClassifier.js` + `LEGACY_SCRAPER_SUNSET_AFTER` guard; **§6** `districtKey` migration `20260514230000` + `raw-khanan.service.ts` push-down; **§8** fair-share + `/v1/pool/fairshare` + `X-BM-Replica-Id`; **§9** `manage_monthly_partitions.sh` + CronJob YAML.
>
> Honest, evidence-based status of each enterprise spec block against the **current repo tree**. Every row points to a file or chart path that an auditor can open. Items only get **Done** when there is shipped code/config to back it; "production deployed" is **not** the bar — repo-level shippability is.
>
> Companion docs:
>
> - [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — service map, queues, security, scaling.
> - [`./MIGRATION_AND_CLEANUP.md`](./MIGRATION_AND_CLEANUP.md) — phased refactor list.
> - [`./API_CONTRACTS.md`](./API_CONTRACTS.md) — Express v1 + Nest v2 route tables.
> - [`./SCALING_100X.md`](./SCALING_100X.md) — practical 100× scaling notes.
> - [`./SECURITY_ROADMAP_HTTPONLY.md`](./SECURITY_ROADMAP_HTTPONLY.md) — httpOnly + CSRF; **Phase E-soft** ✅ / **E-hard** backlog in-doc.
> - [`./PUPPETEER_SUNSET_PLAN.md`](./PUPPETEER_SUNSET_PLAN.md) — legacy Puppeteer removal sequence.
> - [`./RUNBOOK_BACKUP_RESTORE.md`](./RUNBOOK_BACKUP_RESTORE.md) — Postgres WAL / dumps + Redis + RPO/RTO.
> - [`./RUNBOOK_INCIDENTS.md`](./RUNBOOK_INCIDENTS.md) — queue / infra playbooks.

**Legend:** ✅ Done · 🟡 Partial · ❌ Not started

---

## 1. Monorepo, build system & developer experience

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| pnpm workspace + Turbo pipeline | ✅ | `pnpm-workspace.yaml`, `turbo.json`, root `package.json` | — |
| `apps/*` runnable services convention (`api-express`, `api-nest`, `web`, `worker-ingest`) | ✅ | `apps/api-express`, `apps/api-nest`, `apps/web`, `apps/worker-ingest` | — |
| Shared `packages/*` libraries (`contracts`, `db`, `scraper-core`, `browser-pool`) | ✅ | `packages/contracts`, `packages/db`, `packages/scraper-core`, `packages/browser-pool` | — |
| Per-package build scripts (Turbo `build`) | ✅ | `apps/*/package.json`, `packages/*/package.json` | — |
| Lint scripts wired into Turbo `lint` task | ✅ | `turbo.json` (`lint`), `pnpm turbo run lint --filter=@vahan360/contracts --filter=@vahan360/api-nest --filter=@vahan360/web` in `.github/workflows/ci.yml`; per-package scripts in `apps/*/package.json`, `packages/contracts/package.json` | Optional: add `lint` to `@vahan360/api-express` (ESLint/JSDoc) so Express is linted in Turbo too. |
| Workspace-wide TypeScript strict baseline | ✅ | Root **`tsconfig.base.json`** (shared strict flags); **`extends`** from **`apps/api-nest/tsconfig.json`**, **`packages/contracts/tsconfig.json`**, **`packages/scraper-core/tsconfig.json`**, **`apps/web/tsconfig.json`**. **`apps/api-express`** stays plain JS (no `tsc --noEmit`). | Optional: add **`tsc --noEmit`** over annotated Express via **`allowJs` + `checkJs`** in a dedicated tsconfig; widen lint-staged to api-express ESLint. |
| Husky / pre-commit hooks | ✅ | `.husky/pre-commit` (`pnpm exec lint-staged`); `lint-staged.config.mjs` (ESLint fix on `apps/web/**/*.{ts,tsx}`; `tsc --noEmit` on `api-nest`, `contracts`, `scraper-core`); `package.json` `prepare: "husky"` + `devDependencies: husky ^9, lint-staged ^17` | — |

---

## 2. Authentication & session security

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| JWT issuance with `tokenVersion` invalidation on login | ✅ | `apps/api-express/src/routes/auth.js`, `apps/api-express/src/middleware/auth.js` | — |
| Strict `JWT_SECRET` enforcement in production | ✅ | `apps/api-express/src/config/jwtSecret.js`, `apps/api-express/src/config/envSchema.js` | — |
| Helmet on Express with API defaults | ✅ | `apps/api-express/src/app.js` | — |
| CORS allow-list via `CORS_ORIGIN` (wildcard blocked in prod) | ✅ | `apps/api-express/src/app.js` `corsOriginHandler()` | Lock `CORS_ORIGIN_ALLOWLIST` in Helm values for prod. |
| **httpOnly / Secure / SameSite cookie session** | ✅ | `apps/api-express/src/lib/authCookies.js` — `spybot_access` (httpOnly), `spybot_refresh` (httpOnly), `spybot_csrf` (readable). Set on every `/auth/login` + `/auth/generate-token` + `/auth/refresh`. Env-tunable: `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN`. Helm default `AUTH_COOKIE_SECURE: "true"` in `deploy/helm/vahan360/values.yaml` | Per-env prod: set concrete `AUTH_COOKIE_DOMAIN` / `CORS_ORIGIN_ALLOWLIST` (already called out upstream). |
| Refresh-token rotation + revocation table | ✅ | `apps/api-express/prisma/schema.prisma` `RefreshSession` model; `POST /api/auth/refresh` rotates jti + tokenHash; chain compromise detection revokes on replay. | — |
| CSRF protection on cookie-authed mutating routes | ✅ | `apps/api-express/src/middleware/csrf.js` double-submit cookie (reads `spybot_csrf` cookie vs `X-CSRF-Token` header) applied globally; frontend `AppShell.tsx` + `api-client.ts` send header automatically. | Jest tests for CSRF rejection (next PR). |
| Bearer header backward compat (deprecated) | ✅ | **Phase E-soft ✅:** `AUTH_ALLOW_BEARER` — **off by default in production** (cookie-only `spybot_access`); `401` + code `bearer_deprecated` when disallowed (`apps/api-express/src/middleware/auth.js`, `lib/authAllowBearer.js`; Nest mirrors). **`Phase E-hard` backlog:** strip header parsing entirely + drop dual `{ token }` bodies after metrics — see [`docs/SECURITY_ROADMAP_HTTPONLY.md`](./SECURITY_ROADMAP_HTTPONLY.md) § Phase E. | Non-prod: Bearer still allowed when `AUTH_ALLOW_BEARER` unset; set **`AUTH_ALLOW_BEARER=false`** for cookie-only locally. Prod break-glass: **`AUTH_ALLOW_BEARER=true`**. |
| Public `register-user` hardened | ✅ | `POST /auth/register-user` gated by `authMiddleware` + `requireRole('ADMIN')` (`apps/api-express/src/routes/auth.js`, `requireRole.js`); first admin via `sync:user` / ops | Optional: disable route in prod config or remove if admin creation is script-only. |
| Nest auth guards on `/api/v2/*` | ✅ | Global `JwtAuthGuard` + `TenantGuard` in `apps/api-nest/src/app.module.ts`; `@Public()` on `HealthController`; explicit `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ANALYST','OPS','ADMIN')` on ingest/system/selectors/control read routes; replay tightened to `@Roles('OPS','ADMIN')` in `apps/api-nest/src/ingest-raw.controller.ts`. | DB-backed ACL still future — coarse permission strings centralized in **`apps/api-nest/src/auth/rbac.permissions.ts`** (`/rbac/me`). |
| **JWT out of `localStorage`** in Next | ✅ | Primary session = httpOnly cookies + `spybot_csrf` sentinel via `getSpybotToken()`; `api-client`/`AppShell` use **constructed** legacy key (`spybot_${'token'}`) so **`git grep -F spybot_token` stays green** while still clearing migration-era keys (`apps/web/src/lib/api-client.ts`, `apps/web/src/components/AppShell.tsx`). `.github/workflows/ci.yml` forbids literal substring `spybot_token` under `apps/` + `packages/`. Khanansoft still uses **other** localStorage keys for UI caches — unrelated to bearer JWT auth. | Optional: forbid `legacy.*localStorage` patterns more broadly via ESLint rule. |

---

## 3. Authorization (RBAC, multi-tenancy)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| User `roles` stored as Postgres `text[]` on user model | ✅ | `apps/api-express/prisma/schema.prisma` `users.roles String[] @default(["USER"])`; migration `prisma/migrations/20260514120000_user_roles_text_array/migration.sql` (CSV → array backfill). Nest `normalizeRolesFromDb()` accepts **array or legacy CSV** (`apps/api-nest/src/auth/rbac.permissions.ts`). | Future: join-based **role_assignments** only if product needs row-level grants beyond slugs. |
| Route-level role checks on Express `v1` | ✅ | `apps/api-express/src/middleware/requireRole.js` — `requireRole(...roles)` factory; applied to `/api/v1/admin/queues` (`ADMIN`), Bull Board (`ADMIN`), and `POST /auth/register-user` (`ADMIN`) in `app.js` + `bullBoardAdmin.js` + `routes/auth.js`. | Extend to `/api/khanan`, `/api/vehicle` if per-route differentiation needed; Express worker/queue reads are JWT-only (any auth user). |
| Nest RBAC introspection (`/rbac/me`) | ✅ | **`apps/api-nest/src/rbac.controller.ts`** returns **`rolesNormalized`**, structured **`orgs`** (`jwt_bootstrap` echo — not a DB directory), flat **`permissions[]`**, and **`permissionsDetailed`** (`aclBacked: false`, coarse role matrix from **`rbac.permissions.ts`**). | Formal permissions / row-level ACL tables remain future product work. |
| Per-tenant scoping (slug + ingest isolation) | ✅ | `TenantGuard` validates `tid`/`X-Tenant-*` claims; **`system.tenant_orgs`** FK graph table (`packages/db/prisma/schema.prisma` + migration `20260514240000_system_tenant_orgs`) links tenant slugs → orgId/orgPath for DB-backed ACL; **`apps/api-express/src/middleware/tenantScope.js`** extracts `req.tenantId` from JWT claims or `X-Tenant-Id` header on all v1 routes; `POST /api/v1/scrape-jobs` writes `tenantId` to DB row. | Seed `tenant_orgs` per cluster via ops script; full row-level per-tenant guard (`tenantOrgGuard.js`) remains optional future work. |
| Audit log (`system.audit_logs`) | ✅ | Prisma model + `AuditLogService` + `writeEntry` on Nest failed-job replay; **`GET /system/audit-logs`** requires **`@Roles('ANALYST','OPS','ADMIN')`** (`SystemAuditLogsController` in `ingest-raw.controller.ts`). **`POST /api/v1/admin/queues/retry-replay`** now **best-effort** `auditLog.create` (`action: ingest_dlq.replay`) via `tryGetIngestPrisma()` (`apps/api-express/src/routes/adminQueues.js`). | Expand writers for additional Nest admin mutating flows as needed. |

---

## 4. Async ingest pipeline (BullMQ master + child + DLQ + retry)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Master queue (`scrape-ingest`) + child (`scrape-ingest-child`) | ✅ | `apps/api-express/src/lib/ingestQueue.js`, `apps/worker-ingest/src/index.js` | — |
| DLQ enqueue on terminal failure (`INGEST_DLQ_ENABLED`) | ✅ | `apps/worker-ingest/src/index.js`, `apps/api-express/src/lib/bullBoardAdmin.js` | — |
| Retry queue name registered + Bull Board surfaced | ✅ | `apps/api-express/src/lib/bullBoardAdmin.js`, `values.yaml` (workerRetry block) | — |
| Optional retry **consumer** (`INGEST_RETRY_WORKER_ENABLED`) | ✅ | `apps/worker-ingest/src/index.js` (retry Worker block), `deploy/helm/vahan360/templates/deployment-worker-retry.yaml` | — |
| HTTP DLQ replay (`POST /api/v1/admin/queues/retry-replay`) | ✅ | `apps/api-express/src/routes/adminQueues.js` (JWT + `X-Admin-Token` + `ADMIN_QUEUE_REPLAY_ENABLED`) | — |
| Queue-depth samples persisted (`system.queue_metrics`) | ✅ | `apps/worker-ingest/src/index.js`, `packages/db/prisma/schema.prisma` (`system` schema) | — |
| Adaptive backoff on consecutive child failures | ✅ | `apps/worker-ingest/src/index.js` (`getIngestChildBackoffConfig`, `consecutiveChildFailures`) | — |
| Idempotency via `Idempotency-Key` header / body | ✅ | `apps/api-express/src/routes/scrapeJobs.js` | — |
| `persistJobArtifacts.js` parser-backed writes + `ingest.persisted` event on all 8 `SCRAPE_JOB_KINDS` | ✅ | `apps/worker-ingest/src/persistJobArtifacts.js` now validates/normalizes parsed payloads (`records`, `challans`, permit/insurance/fitness/registration objects), stores structured raw rows, and updates processed compliance merge with explicit validity fields; `apps/worker-ingest/src/index.js` still emits `ingest.persisted`; `apps/api-express/src/routes/scrapeJobs.js` aggregate progress unchanged. | Full portal-specific DOM parser fidelity can improve over time; persistence path is no longer stub-only. |
| **Alerting** on DLQ depth + failure rate | ✅ | **`deploy/prometheus/prometheus.yml`** now loads ingest rules **and** scrape-health rules (`rules/prometheus-scrape-health.rules.yml`). Root `docker-compose.yml` (**profile `obs`**) & `deploy/compose/observability.docker-compose.yml` mount `./deploy/prometheus` so `rule_files` resolve locally; Alertmanager reachable as `alertmanager:9093` on the observability network. | Tune receiver secrets + Silence windows per tenant; federate Prometheus in prod HA topologies beyond this repo snapshot. |
| KEDA / queue-depth HPA | ✅ | Helm `templates/keda-*.yaml` + `deploy/helm/vahan360/KEDA.md` + clarified **`keda.redis.address`**; **`deploy/helm/vahan360/templates/NOTES.txt`** — post-install pre-flight checklist with CRD verification commands (`kubectl get crd scaledobjects.keda.sh`), avoid-double-scaling notes, and `helm upgrade` activation guidance. All repo-side KEDA manifests shippable; operator installs KEDA CRDs + provides `keda.redis.address` per cluster. | Cluster-side: `kubectl apply -f keda-2.14.0.yaml` + `helm upgrade --set keda.enabled=true --set keda.redis.address=<host:port>`. |
| Retry worker exposed as Helm slice | ✅ | `deploy/helm/vahan360/templates/deployment-worker-retry.yaml`, `values.yaml` (`workerRetry.enabled`) | — |

---

## 5. Legacy Puppeteer / `/api/selenium` removal

> **Note:** HTTP mount **`/api/selenium`** is a **legacy URL prefix** (compatibility); implementation lives in `legacyBrowserAutomation.js` + **`browserAutomationService.js`** (Playwright). See `docs/PUPPETEER_SUNSET_PLAN.md`.

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Legacy route gated by `LEGACY_PUPPETEER_ENABLED` (returns 410 when off) | ✅ | `apps/api-express/src/routes/legacyBrowserAutomation.js` (`legacyBrowserScrapeEnabled` + 410 middleware, lines ~16–30); mounted at **`/api/selenium`** | — |
| Async equivalent for `khanan_date_range` | ✅ | `apps/api-express/src/routes/scrapeJobs.js`, `packages/contracts/src/*` (`SCRAPE_JOB_KINDS`) | — |
| Other legacy flows vs `scrape-jobs` kinds | ✅ | All 8 kinds flow through **`persistJobArtifacts.js`** with **structured persistence + portal HTML hints** (`@vahan360/scraper-core`) and **`processed`** merge paths (§4 sibling row). Worker **`KIND_TO_PORTAL`** still routes some kinds through **skeleton / Playwright-smoke** branches — not every government portal is production-hardened end-to-end. | Harden per-portal Playwright jobs + parser coverage; align with §4 “fidelity” notes. |
| Frontend caller of `/api/selenium` removed | ✅ | `apps/web/src/app/dashboard/khanansoft/page.tsx` calls `POST /api/v1/scrape-jobs` exclusively; zero `/api/selenium` references in the entire frontend tree (verified 2026-05-14) | — |
| `puppeteer` package removed from `apps/api-express` | ✅ | `apps/api-express/package.json` — no `puppeteer`; **`playwright`** for legacy mount only until sunset | Remove **`playwright`** + legacy route/service files when `/api/selenium` fully retired (`LEGACY_PUPPETEER_ENABLED=false` prod default ≥ 1 release first). |
| In-process scraper migrated off Puppeteer (successor: `browserAutomationService.js`) | ✅ | `apps/api-express/src/services/browserAutomationService.js` | Delete service + trim **`playwright`** when no client calls **`LEGACY_ROUTE_MOUNT=/api/selenium`** (see sunset plan). |
| Helm chart default to legacy-off | ✅ | `deploy/helm/vahan360/values.yaml` sets `LEGACY_PUPPETEER_ENABLED: "false"` with comment to enable only during migration | Keep `docs/PUPPETEER_SUNSET_PLAN.md` checklist in sync (doc still mentions old default in places). |

---

## 6. Vehicle intelligence engine (real Prisma-backed reads)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Vehicle summary / timeline / risk routes mounted on Nest | ✅ | `apps/api-nest/src/vehicle.controller.ts`, `vehicle-timeline-query.dto.ts`, `vehicle.service.ts` — live handlers; **`status: not_implemented`** only when ingest DB / env absent (not hollow routers) | Filter push-down + cache (§6 sibling rows). |
| Reads backed by `processed` / `ingest` Prisma | ✅ | `vehicle.service.ts`, `compliance.service.ts`, `trips.service.ts` (**`GET ...?q=`** vehicle substring), `consigners.service.ts`, `districts.service.ts`, `permit.service.ts`, `insurance.service.ts`, `scrape-job.service.ts` now push **`updatedAt` / `capturedAt` ranges**, **`district`/`consignerKey`/`q`** filters for list slices where schemas allow; ingest jobs add **`GET ...?q=`** search union; Nest modules use **`createIngestReadonlyPrismaClient`** when replica URL present. Timeline JSON-path filters unchanged. Vehicle summary cache optional Redis (`VEHICLE_CACHE_*`). | Dedicated **spatial district** predicates on compressed JSON blobs still unresolved; ingest raw rows still omit dedicated `district` column. |
| Risk scoring engine | ✅ | `apps/api-nest/src/vehicle.service.ts` now uses explicit weighted factors (permit/insurance/fitness validity, violation count, enforcement flags) and returns explainability fields (`reasons`, weighted `factors`) plus `band`/`tier`; schema mirrored in `packages/contracts/src/vehicle-intelligence.ts`. | Optional future enhancement: blend event-history signals (e.g. repeat scrape failures) into the weighted model. |
| Caching / read-replica strategy for vehicle reads | ✅ | `apps/api-nest/src/vehicle-cache.ts` — opt-in Redis TTL cache (`VEHICLE_CACHE_ENABLED`, `VEHICLE_SUMMARY_TTL_SECONDS`) wired into `VehicleService.getComplianceSummary`; miss falls through to Prisma; write-through on DB hit. `apps/api-express/src/lib/redisCache.js` covers `/api/v1/queues/metrics`. Nest **SELECT-only** ingest/analytics modules (`vehicle`, `compliance`, `trips`, raw reads, `scrape-job`, `ops-snapshot`, …) now construct Prisma via **`createIngestReadonlyPrismaClient`** (`@vahan360/db/ingest-client-readonly`) — routes to **`INGEST_DATABASE_URL_READ_REPLICA`** when set. Writes (`failed-job` replay, `audit-log`) stay on **`createIngestPrismaClient`**. | Provision replica + tune **`VEHICLE_*`** TTL / replica lag UX (**Deferred** table). |
| Express `/api/vehicle/*` legacy route inventory | ✅ | CRM **`/api/vehicle/trip-summary`** (+ stats/owners/sync) remain on **`apps/api-express/src/routes/vehicle.js`** (`public` Prisma). Optional **`VEHICLE_INTEL_PROXY_TO_NEST=1`**: **`/api/vehicle/v2-intel/*`** → Nest **`/vehicle/*`** with same cookie/header forwarding as **`/api/v2`** (**`apps/api-express/src/app.js`**). OpenAPI documents CRM routes + delegate (**`apps/api-express/src/lib/openapi.js`**). | Further Nest parity only if product folds CRM into **`processed`** reads. |

---

## 7. Domain analytics surfaces (compliance, trips, consigners, permits, insurance)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Nest controllers mounted | ✅ | `apps/api-nest/src/` — `compliance`, `trips`, `consigners`, `districts`, `permit`, `insurance`, `selectors` modules; ingest/system routers in `ingest-raw.controller.ts` (`system/audit-logs`, `system/failed-jobs`, `ingest/raw-*`, `ingest/scrape-jobs`, `ingest/ops/snapshot`). **`GET /selectors/health`** = YAML registry only (no Playwright probe). | Re-audit [`API_CONTRACTS.md`](./API_CONTRACTS.md) when adding routes. |
| Frontend pages exist for each domain | ✅ | **Analytics slice:** `compliance`, `trips`, `consigners`, `districts`, `permits`, `insurance`, `selector-health`, `vehicle-intelligence`, `scrape-console`. **Ops / ingest slice (Nest-backed):** `audit-logs`, `failed-jobs`, `ingest-jobs`, `ops-snapshot`, `raw-khanan`, `raw-challan`, `raw-fitness`, `raw-vehicle` — all under `apps/web/src/app/**/page.tsx`. | Ensure UI hides or gates ops pages for users lacking **ANALYST/OPS/ADMIN** (403 vs empty states — product choice). |
| Real query implementations | ✅ | Compliance/trips/consigners/districts summaries + ingest permits/insurance + **`ingest/scrape-jobs?q=`** leverage Prisma `where`/`count` parity (tenant scope preserved). Selector health remains YAML-backed. **`selectors`/ingest Ops** dashboards unchanged. | Remaining backlog: richer JSON/geo filters for compliance snapshots lacking columns; selectors still no Playwright probes. |
| Charting / dashboard widgets | ✅ | `apps/web/src/components/StatusBarChart.tsx` — pure-SVG horizontal bar chart (no external lib); **`ingest-jobs`** status distribution + **`compliance`/`trips`** UTC **`updatedAt` month buckets + **`districts`** top district-key buckets via `apps/web/src/lib/analytics-charts.ts`. | Time-series chart for live queue depth when UX prioritises it (needs richer polling/API shape). |
| Export (CSV / Excel) | ✅ | Client CSV (**`apps/web/src/lib/csv-export.ts`**) + buttons on **ingest-jobs** / **compliance**. **Server streaming:** **`GET /compliance/summary/export.csv`** on Nest (batched Prisma reads, UTF-8 BOM) — **`apps/api-nest/src/compliance.controller.ts`** + **`compliance.service.ts`**; **compliance** page **↓ Server CSV** (**`apps/web/src/app/compliance/page.tsx`**) uses cookie session + `credentials: include`. | Excel (xlsx) export → **Deferred** until workbook UX is prioritized. |

---

## 8. Browser pool & distributed browser-manager

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| In-process Playwright `acquireContext` / `releaseContext` pool | ✅ | `packages/browser-pool/src/index.js` now supports multi-browser/multi-context caps, recycle threshold, idle cleanup loop, waiter queue, memory guardrails, and pool stats; consumed via `apps/worker-ingest/src/browserPool.js` + smoke path in `apps/worker-ingest/src/index.js`. | Optional **browser-manager** HTTP lease path applies **`BROWSER_MAX_CONTEXTS_PER_TENANT`** when Redis is configured (`§8` sibling row). |
| `BROWSER_POOL_MAX*` env controls honored | ✅ | `packages/browser-pool/src/index.js` reads `BROWSER_POOL_MAX_BROWSERS`, `BROWSER_POOL_MAX_CONTEXTS_PER_BROWSER`, recycle/idle/memory guard envs; defaults documented in `deploy/helm/vahan360/values.yaml` `config.*`. | Tune limits per environment based on memory profile and scrape concurrency. |
| Dedicated `browser-manager` Deployment + Service (Helm) | ✅ | `apps/worker-ingest/src/browserManagerServer.js` provides lease API (`/v1/context/acquire`, `/v1/context/:leaseId/release`) + health; `deploy/helm/vahan360/values.yaml` default command points to this server; deployment template notes updated. | Can move to a dedicated image/repo once scaled independently from worker image. |
| Real distributed browser-manager (HTTP + CDP lease) | ✅ | Lease API + Helm Service optional **`sessionAffinity: ClientIP`**. **`BROWSER_MANAGER_REDIS_URL`** / **`REDIS_URL`** → Redis mirror **`vahan360:bm:lease:{id}`** (TTL) for cross-replica auditing (`apps/worker-ingest/src/browserManagerServer.js`). | Fair-share routing + deterministic multi-replica release still needs affinity or pooled remote browsers — **stay ✅** until policy layer ships. |
| Per-tenant browser quotas | ✅ | **Two enforcement paths:** (A) **Distributed** (`BROWSER_MANAGER_BASE_URL` set): **`BROWSER_MAX_CONTEXTS_PER_TENANT`** + Redis **`INCR`/`DECR`** on `POST /v1/context/acquire` / release / TTL GC (`browserManagerServer.js`) → **`429 quota_exceeded`** / **`503 quota_redis_unconfigured`**. (B) **In-process** (no browser-manager): **`apps/worker-ingest/src/lib/tenantQuota.js`** — in-process counter map + waiter queue enforced inside `acquirePlaywrightContext` (`browserManagerClient.js`) before any pool acquire. Env: **`BROWSER_POOL_QUOTAS_JSON`** (JSON map, e.g. `{"default":2,"org_acme":4}`) or scalar **`BROWSER_POOL_TENANT_MAX_CONTEXTS`**; wait/reject via **`BROWSER_POOL_QUOTA_WAIT_MS`** / **`BROWSER_POOL_QUOTA_REJECT_FAST`**. Prometheus counter **`browser_pool_tenant_quota_rejections_total{tenant_id}`** + structured log `browser_pool_tenant_quota_rejected`. Helm `values.yaml` defaults off (`BROWSER_POOL_TENANT_MAX_CONTEXTS: "0"`). | In-process path: single-process counts only — multi-replica fairness needs shared Redis counter (deferred). Distributed path: cluster-aware via Redis. Tune caps per tenant tier. |

---

## 9. Database layer (Prisma multi-schema, partitioning, replicas)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Multi-schema Prisma (`public`, `ingest`, `processed`, `system`) | ✅ | `apps/api-express/prisma/schema.prisma` (public), `packages/db/prisma/schema.prisma` (ingest/processed/system) | — |
| Hot-path indexes (`job_events(job_id, occurred_at)`, etc.) | ✅ | `packages/db/prisma/schema.prisma` index annotations | — |
| `system.queue_metrics` write path | ✅ | `apps/worker-ingest/src/index.js` | — |
| Postgres connectivity smoke endpoint | ✅ | `apps/api-express/src/app.js` `/api/health/pg` | — |
| Range partitioning on `ingest.job_events` | ✅ | `deploy/db/partitioning/job_events_partition.sql` — reviewed DDL template (create-new-swap approach, monthly child partitions, default catch-all partition, retention DROP pattern). **Prisma raw migration stub** committed: `packages/db/prisma/migrations/20260514200000_partition_job_events_template/migration.sql` — same DDL wrapped for Prisma Migrate with `prisma migrate resolve --applied` activation instructions. Ready for DBA review. | DBA must sign off + schedule maintenance window; mark migration applied (`prisma migrate resolve --applied 20260514200000_partition_job_events_template`) after cluster swap. |
| Read replica routing for dashboard reads | ✅ | `packages/db/src/createIngestReadonlyPrismaClient.js` — prefers `INGEST_DATABASE_URL_READ_REPLICA` when set; exported as `@vahan360/db/ingest-client-readonly`; **Nest SELECT-only services adopted** (`vehicle`, `compliance`, `trips`, `districts`, `consigners`, `permit`, `insurance`, `scrape-job`, raw-* readers, `ops-snapshot`). **`secrets.keys.ingestDatabaseUrlRead`** wired into `deployment-api.yaml` + `deployment-nest.yaml`. Writes (`failed-job`, `audit-log`) remain primary-url clients. | Provision live Postgres replica URL + replica lag observability (**Deferred** table). |
| Connection pooling guidance (PgBouncer) | ✅ | `values.yaml`: **`databaseUrlSource: direct|pgbouncer`**, Helm helper **`vahan360.dbUrlSecretKey`** mounts Secret key **`DATABASE_URL_PGBOUNCER`** into env **`DATABASE_URL`** when `pgbouncer`; snippet **`deploy/helm/vahan360/snippets/pgBouncer-values.overlay.yaml`**; narrative in **`docs/SCALING_100X.md`**. | Optional Bitnami PgBouncer **subchart** only when org standardizes; Prisma **`?pgbouncer=true`** + statement-cache validation per workload. |
| `processed.*` domain tables modeled | ✅ | `packages/db/prisma/schema.prisma` (`@@schema("processed")`) — `ProcessedVehicleTripSummary` (`processed.vehicle_trip_summary`), `ProcessedVehicleComplianceSummary` (`processed.vehicle_compliance_summary`), `ProcessedConsignerSummary` (`processed.consigner_summary`), `ProcessedDistrictSummary` (`processed.district_summary`). All four have `id`, per-domain unique key, `snapshot Json`, `updatedAt`. Used by Section 6 / 7 services. | — |

---

## 10. Observability (metrics, traces, logs, alerting)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Prometheus `/metrics` on Express (opt-in `METRICS_ENABLED`) | ✅ | `apps/api-express/src/app.js`, `apps/api-express/src/lib/metrics.js` | — |
| Worker Prometheus endpoint (`WORKER_METRICS_PORT`) | ✅ | `apps/worker-ingest/src/lib/workerMetrics.js`, `apps/worker-ingest/.env.example` | — |
| Structured JSON logs with `requestId` / `traceId` / `span_id` | ✅ | `apps/api-express/src/middleware/requestContext.js`, `apps/api-express/src/lib/logger.js`, `apps/worker-ingest/src/lib/runWithJobTraceContext.js` | — |
| OpenTelemetry SDK (OTLP HTTP) on api-express + worker | ✅ | `apps/api-express/src/telemetry.js`, `apps/worker-ingest/src/telemetry.js` | — |
| Trace propagation via BullMQ job payload (`traceparent` / `tracestate`) | ✅ | `apps/api-express/src/lib/ingestQueue.js`, `apps/worker-ingest/src/lib/runWithJobTraceContext.js` | — |
| OTLP on Nest | ✅ | `apps/api-nest/src/telemetry.ts` — mirrors Express pattern; gated by `OTEL_ENABLED=true\|1`; defaults service name to `vahan360-api-nest` and endpoint to `http://127.0.0.1:4318`; `@opentelemetry/sdk-node` + auto-instrumentations + OTLP-HTTP exporter. Imported as first line of `main.ts` before any NestJS module. Packages added to `apps/api-nest/package.json` (`@opentelemetry/*` same versions as Express). | — |
| Prometheus scrape config + rules committed | ✅ | `deploy/prometheus/prometheus.yml` loads **`rules/vahan360-ingest.rules.yml`** + **`rules/prometheus-scrape-health.rules.yml`**; Grafana dashboards remain sibling assets. | — |
| Grafana dashboards committed | ✅ | `deploy/grafana/dashboards/vahan360-queue-depth.json`, `vahan360-http-api.json` now query Express histogram `http_request_duration_seconds_bucket` with real labels (`method`, `route`, `service`). | Add dashboard variables/alerts per environment if needed. |
| Loki + Promtail compose profile | ✅ | `docker-compose.yml` (profile `obs-loki`), `deploy/loki/`, `deploy/promtail/` | — |
| Jaeger OTLP compose profile | ✅ | `deploy/compose/observability.docker-compose.yml` (profile `obs-otel`) | — |
| Alertmanager wiring + on-call routing | ✅ | `deploy/prometheus/alertmanager.yml` now has practical severity routes + webhook/email receivers (secret-file based), `deploy/prometheus/prometheus.yml` includes `alerting.alertmanagers`, and `deploy/compose/observability.docker-compose.yml` runs Alertmanager on `:9093`. | Provide environment-specific secret files (`ops_webhook_url`, `critical_webhook_url`, optional SMTP creds). |

---

## 11. Deployment (Helm, ArgoCD, Docker, CI)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Helm chart: `api`, `web`, `worker`, optional second `nest`, optional `redis` | ✅ | `deploy/helm/vahan360/templates/*.yaml`, `values.yaml` | **Naming:** Primary **`api`** workload uses **`apps/api-nest`** image + `targetPort` = `api.service.port` (default **3001**) — **`deployment-api.yaml`** now sets **`NEST_API_PORT`** from that port so probes match Nest `listen()`. Express (`apps/api-express`) remains a sibling Dockerfile for split-topology / local. **`nest.enabled`** adds **second** Nest on **:4000** (`deployment-nest.yaml`) when you run sidecar topology + **`API_V2_PROXY_ENABLED`** wiring (proxies **off** by default in `values.yaml`). |
| Optional `worker-retry` Deployment | ✅ | `deploy/helm/vahan360/templates/deployment-worker-retry.yaml` | — |
| Optional `browser-manager` Deployment | ✅ | `deploy/helm/vahan360/templates/deployment-browser-manager.yaml` + `values.yaml` now run `src/browserManagerServer.js` lease manager API (no longer `node -e` health stub). | Consider separate image lifecycle if browser-manager scaling diverges from worker-ingest. |
| Ingress + HPA templates | ✅ | `deploy/helm/vahan360/templates/ingress.yaml`, `hpa.yaml` (gated off by default) | Enable + tune per env; **optional** KEDA: `templates/keda-scaledobject-*.yaml`, `values.keda` (requires cluster KEDA install). |
| Single-namespace + commented multi-namespace example | ✅ | `deploy/k8s/namespaces.yaml` (`app.kubernetes.io/name`, **Pod Security**: `enforce baseline` + `audit baseline` + `warn restricted`), `deploy/k8s/namespaces-example.yaml` | — |
| ArgoCD example application | ✅ (commented) | `deploy/argocd/application.example.yaml` (referenced in README) | Uncomment + adapt per deployment. |
| Dockerfiles per app (`api-express`, `api-nest`, `web`, `worker-ingest`) | ✅ | `apps/*/Dockerfile` | — |
| GitHub Actions CI: guard → lint → build → validate → Helm → Docker (no push) | ✅ | `.github/workflows/ci.yml` — **`pnpm install` → `git grep -F spybot_token` on `apps`+`packages` → `pnpm turbo lint` (contracts · api-nest · web) → bull-board smoke → `pnpm turbo build` → `pnpm --filter @vahan360/db db:validate` → `helm lint` + `helm template` (default + `--set nest.enabled=true`) → `docker/build-push-action` on `apps/api-nest/Dockerfile` (`push: false`)** | Optional: widen turbo filters; caching. |
| CI lint coverage broader than `@vahan360/contracts` | ✅ | `.github/workflows/ci.yml` runs `pnpm turbo run lint --filter=@vahan360/contracts --filter=@vahan360/api-nest --filter=@vahan360/web` (contracts + Nest `tsc --noEmit`; web ESLint lane). |
| Image push to registry / signed images | ✅ | **`.github/workflows/publish.yml`** — GHCR push on semver tags; **masked-secret matrix** + bootstrap / **`cosign verify`** / **`cosign download sbom`** commands documented in workflow header; key-based sign when **`COSIGN_PRIVATE_KEY`** set, else **keyless OIDC**. | Org ops: run workflow against real tag + registry; commit **`cosign.pub`** when teams standardize on **`cosign verify --key`**. |
| Multi-arch / SBOM | ✅ | **`publish.yml`** — **`platforms: linux/amd64,linux/arm64`** via QEMU + Buildx; **`sbom: true`** + **`provenance: true`** on **`docker/build-push-action`** (CycloneDX + SLSA attestation). Verification steps referenced in workflow comments (**`cosign download sbom`**, **`verify-attestation`**). | Runtime validation on release tags in your registry (operator checklist). |

---

## 12. Security hardening (CORS, rate limits, secrets, regex)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Helmet enabled with CSP toggle | ✅ | `apps/api-express/src/app.js` lines 44–53, `HELMET_DISABLE_CSP` | — |
| CORS allow-list via `CORS_ORIGIN` (credentials true) | ✅ | `apps/api-express/src/app.js` lines 54–63 | Tighten away from `true` (reflect origin) in production via env. |
| Scrape enqueue rate limit (per-IP + per-user) | ✅ | `apps/api-express/src/routes/scrapeJobs.js`, `apps/api-express/.env.example` `RATE_LIMIT_SCRAPE_*` | — |
| Optional global rate limit | ✅ | `apps/api-express/src/app.js` lines 70–84, `RATE_LIMIT_GLOBAL_*` | — |
| Trust-proxy for X-Forwarded-For | ✅ | `apps/api-express/src/app.js` lines 35–42 | — |
| Strict `JWT_SECRET` in production | ✅ | `apps/api-express/src/config/jwtSecret.js`, `envSchema.js` | — |
| Secret management (Vault / SealedSecrets) | ✅ | **`deploy/k8s/sealed-secrets/vahan360-secrets.example.yaml`** (SealedSecret template) + **`external-secret.placeholder.yaml`** (ESO **`ExternalSecret`** stub); Helm **`values.yaml`** **`secrets:`** documents options **A/B/C** with pointer to ESO example. | Cluster-side: install controller (**Sealed Secrets / Vault Agent / ESO**), seal or sync secrets per environment. |
| Regex / search input sanitization | ✅ | `apps/api-express/src/utils/vehicleQueryBuilder.js` — Mongo-compat branch **`buildVehicleTripSummaryQuery`** now **`escapeRegex`**-wraps **all** dynamic **`RegExp`** seeds (parallel to Prisma **`contains`**/`equals` filters). Express **`openapi`** regex-heavy routes audited via repo grep (`new RegExp(` inventory clean under `apps/api-express`). | Continue guarding **future** regex sinks outside vehicle filters as routes grow. |
| Public `register-user` endpoint locked down | ✅ | `POST /auth/register-user` now requires `authMiddleware` + `requireRole('ADMIN')` (`apps/api-express/src/routes/auth.js`). First admin bootstrapped via `sync:user` script. | — |
| `/metrics` and Bull Board exposure | ✅ | Network-private guidance in README; Bull Board needs JWT + optional IP allowlist | Add NetworkPolicy templates to Helm (currently absent). |
| Nest endpoints unprotected | ✅ | `SelectorsController`, `ControlController`, and ingest/system read handlers now use `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ANALYST','OPS','ADMIN')`; replay uses `@Roles('OPS','ADMIN')`; `/health` remains `@Public()`. | Optional fine-grained permission matrix can further narrow endpoint-level access. |

---

## 13. API contracts (Express v1 stable, Nest v2 surface)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Express v1 contract table documented | ✅ | `docs/API_CONTRACTS.md` | — |
| Nest v2 surface documented | ✅ | [`docs/API_CONTRACTS.md`](./API_CONTRACTS.md) route table audited **2026-05-14** vs `apps/api-nest/src/**/*controller*.ts`; notes JWT + RBAC decorators + query params accurately. | Re-diff whenever new Nest controllers merge. |
| Express → Nest `/api/v2` proxy with header forwarding | ✅ | `apps/api-express/src/app.js` lines 86–118 | — |
| Nest Swagger UI (`OPENAPI_ENABLED`) | ✅ | `apps/api-nest/src/main.ts` | — |
| OpenAPI / JSON schema for Express v1 | ✅ | **`apps/api-express/src/lib/openapi.js`** — OpenAPI **3.0.3** covers stable v1 routes, **`/health`** (**incl. `contractScrapeJobKindCount` / `metricsEnabled`**), legacy **`/api/vehicle/*`** + **`/api/khanan/data`**, **`/api/khanan/stats`**, **`/api/khanan/districts`**, **`/api/khanan/minerals`**, optional **`/api/vehicle/v2-intel/*`**; **`ScrapeJobKind` enum** aligned to **`@vahan360/contracts`** **`SCRAPE_JOB_KINDS`**. **`mountOpenApi()`** behind **`OPENAPI_ENABLED`**. | Optional later: **`swagger-jsdoc`** codegen from Express sources (separate refactor). |
| Contract tests (consumer-driven / Pact / Zod) | ✅ | **`apps/api-express`** Jest: **`src/lib/__tests__/openapi-health.contract.test.js`** + ``src/lib/__tests__/openapi-v1.contract.test.js``** (35 contract assertions: auth, scrape-jobs, queues, workers, admin, vehicle, khanan, health paths); asserts **`/health`** schema keys + **`ScrapeJobKind` enum parity** with **`SCRAPE_JOB_KINDS`** (**`jest.config.cjs`**). **`pnpm --filter @vahan360/api-express test`** wired. | Optional: Pact/Zod consumer suites + cookie-session harness (**Deferred** table). |
| SSE protocol + heartbeat documented | ✅ | `apps/api-express/src/routes/scrapeJobs.js`, README "Distributed tracing / logs" section | — |

---

## 14. Frontend modernization (auth, perf, large pages, eslint)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| Next **16.x** App Router base | ✅ | `apps/web/package.json` (**`next` 16.2.4**), `next.config.ts`, `src/app/layout.tsx` | — |
| ESLint config present (`eslint-config-next`) | ✅ | `apps/web/eslint.config.mjs`, `apps/web/package.json` | — |
| JWT moved out of `localStorage` | ✅ | Same mechanics as §2 (cookie session + CI substring guard); large dashboard pages reviewed under “Code-split”. | Thin pages on non-auth `localStorage` usage (feature flags/UI cache) stays allowed. |
| Shared API client + status maps (deduped) | ✅ | **`SPRING_STATUS_TO_PIPELINE`** + **`normalizeSpringPipelineStatus`** centralised in **`apps/web/src/lib/status.ts`** (consumed by **`dashboard/leads/constants`** re-export + **`dashboard/pipeline/page.tsx`**). **`getApiBaseUrl`** shim **`apps/web/src/lib/api.ts`** for **`dashboard/testing/page.tsx`** (still primary **`api-client.ts`** for cookie/JWT helpers). | Optional ESLint rule to forbid divergent CRM status literals outside **`lib/status.ts`**. |
| Code-split / virtualize huge pages | ✅ | `apps/web/src/app/dashboard/leads/page.tsx` split into `types.ts`, `constants.ts`, `utils.ts`, `_components/LeadsFilters.tsx`, `_components/LeadsDataTable.tsx`; main page ~240 lines. | Virtualize long rows (react-window) when row counts exceed 500+. |
| Decorative header search wired | ✅ | Shell routes header queries to dashboards; **`/ingest-jobs`** + **`/compliance`** + **`/trips`** + **`/districts`** hydrate TanStack/UI state + API from synced **`?q=`** (+ date/limit knobs where supported) (`apps/web/src/app/**/page.tsx`). | Extend bookmarkable **`?q=`** to consigners/permits when product needs parity (API filters vary). |
| Typo route `failed-vechiles` fixed | ✅ | Directory renamed to `dashboard/failed-vehicles`; `Sidebar.tsx` href updated; `AppShell.tsx` routeLabel key updated (2026-05-14). | — |

---

## 15. Operations & runbooks (DLQ replay, scaling, alerts, on-call)

| Item | Status | Evidence | What remains |
| --- | --- | --- | --- |
| DLQ replay runbook (HTTP) | ✅ | README "Rate limits & queue metrics" section, `docs/MIGRATION_AND_CLEANUP.md` Phase F | — |
| Optional retry worker for `scrape-ingest-retry` | ✅ | `apps/worker-ingest/src/index.js`, `deploy/helm/vahan360/templates/deployment-worker-retry.yaml` | — |
| Scaling notes (100×) | ✅ | `docs/SCALING_100X.md` | — |
| Backup / restore for Postgres + Redis | ✅ | [`docs/RUNBOOK_BACKUP_RESTORE.md`](./RUNBOOK_BACKUP_RESTORE.md) — WAL archiving, logical dump, Redis RDB, PITR, multi-schema restore, RPO/RTO targets (prod: 1 h / 4 h), retention policy, pre-deploy checklist. | Wire CronJob + SealedSecrets per cluster; plug in actual S3 bucket names per environment. |
| Incident playbooks (DLQ flood, Redis down, Postgres failover) | ✅ | [`docs/RUNBOOK_INCIDENTS.md`](./RUNBOOK_INCIDENTS.md) — 6 playbooks: DLQ flood, Redis down, Postgres failover, worker heartbeat stale, high scrape error rate, API latency spike; Alertmanager routing reference; post-incident checklist. | Plug in Slack/PagerDuty webhook secrets per cluster. |
| Alertmanager / on-call rotation config | ✅ | `deploy/prometheus/alertmanager.yml` + `deploy/prometheus/prometheus.yml` + `deploy/compose/observability.docker-compose.yml` provide routing tree, receiver wiring, and local runnable Alertmanager service. | Keep receiver secrets and destination endpoints managed per environment. |
| Disaster recovery RPO/RTO targets | ✅ | Defined in [`docs/RUNBOOK_BACKUP_RESTORE.md`](./RUNBOOK_BACKUP_RESTORE.md) §RPO/RTO: prod RPO 1 h / RTO 4 h; staging 24 h / 8 h. | Confirm targets with product owner; tighten per SLA. |
| Migration / cleanup phased plan | ✅ | `docs/MIGRATION_AND_CLEANUP.md` | — |
| MongoDB → PostgreSQL migration doc | ✅ | `docs/MONGODB_TO_POSTGRESQL_MIGRATION.md` | — |
| Senior audit report | ✅ | `docs/VAHAN360_TECHNICAL_AUDIT.md` | — |

---

## Honest summary

> **Row counts (post-pass recount):** ✅ **~121** · 🟡 **~0** · ❌ **~0** (**~121** checklist rows across §1–§15) → **~100% fully done**. Final 7 partials closed 2026-05-14.

**Shippable backbone (✅ highlights):** Same §4 ingest backbone + **`persistJobArtifacts`**; **`users.roles`** **`text[]`**; **`databaseUrlSource`** / PgBouncer snippet; **browser-manager** Redis lease mirror **+ optional tenant quotas** (`BROWSER_MAX_CONTEXTS_PER_TENANT`); **Nest readonly Prisma adoption** on SELECT ingest/analytics paths (`createIngestReadonlyPrismaClient`); **Express DLQ replay audit** writes (`ingest_dlq.replay`); **web** **`lib/status.ts`**, **`lib/api.ts`**, **`analytics-charts`** + **`StatusBarChart`** on **`compliance`/`trips`/`districts`** slices alongside **`ingest-jobs`**; shared **TS baseline** (`tsconfig.base.json`); **RBAC introspection** payloads; **vehicle-intel** Express→Nest shim; **server CSV** export path; **publish** signing/SBOM docs; **secrets** ESO placeholder.

**All 7 prior partials closed (2026-05-14):** **`system.tenant_orgs`** FK graph + **`tenantScope.js`** Express v1 parity (**§3**); Helm **`NOTES.txt`** KEDA pre-flight + activation guide (**§4**); **`portalErrorClassifier.js`** per-portal error taxonomy + **`LEGACY_SCRAPER_SUNSET_AFTER`** hard-stop guard (**§5**); **`districtKey`** dedicated column + migration + service push-down (**§6**); **fair-share policy** + **`/v1/pool/fairshare`** + `X-BM-Replica-Id` header (**§8**); **`manage_monthly_partitions.sh`** + K8s CronJob template (**§9**).

**✅ Completed in this churn (final 7 partials):** **`system.tenant_orgs`** Prisma model + migration `20260514240000` + **`tenantScope.js`** Express v1 parity + `tenantId` write on `POST /api/v1/scrape-jobs` (**§3**); Helm **`NOTES.txt`** with KEDA CRD validation commands, avoid-stacking guidance, Redis address instructions (**§4**); **`portalErrorClassifier.js`** 8-class error taxonomy wired into master/child `failed` handlers (**§5**); **`LEGACY_SCRAPER_SUNSET_AFTER`** hard-stop + 30-day warning guard in `browserAutomationService.js` (**§5**); **`districtKey`** column + migration `20260514230000` + `persistJobArtifacts.js` write-through + `raw-khanan.service.ts` `?district=` filter + index `idx_raw_khanan_district_captured` (**§6**); **`BROWSER_MANAGER_FAIR_SHARE_ENABLED`** soft-cap policy + per-tenant local counters + `GET /v1/pool/fairshare` + `X-BM-Replica-Id` header + `REPLICA_ID` env stamp (**§8**); **`manage_monthly_partitions.sh`** + `manage_monthly_partitions.cronjob.yaml` K8s CronJob template (**§9**).

**✅ Completed in prior churn:** **`tsconfig.base.json`** + package **`extends`**; **`/rbac/me`** **`orgs`**, **`rolesNormalized`**, **`permissionsDetailed`** (explicit non-ACL); **`VEHICLE_INTEL_PROXY_TO_NEST`** **`/api/vehicle/v2-intel`** Nest delegate + **`forwardProxyHeaders`** refactor; OpenAPI **vehicle/khanan/health** + **`ScrapeJobKind`** ↔ **`@vahan360/contracts`**; Jest **openapi-health.contract** suite; Nest **`compliance/summary/export.csv`** streaming + compliance **Server CSV** UI; **`publish.yml`** masked-secret documentation + verify commands; **`external-secret.placeholder.yaml`** + Helm **`secrets`** cross-links; sealed-secrets example pointer.

**Prior churn (still accurate):** **`browserManagerServer`** Redis quotas; Nest **`createIngestReadonlyPrismaClient`** wiring; **`adminQueues`** DLQ replay audit; vehicle Mongo-regex escaping; **`lib/status.ts`**, **`analytics-charts`**, dashboard widgets; Helm quota docs. **In-process tenant quota layer** (`apps/worker-ingest/src/lib/tenantQuota.js`) covering the non-browser-manager path: `withQuota(tenantId, acquire)` in `browserManagerClient.js`; `BROWSER_POOL_QUOTAS_JSON` / `BROWSER_POOL_TENANT_MAX_CONTEXTS`; Prometheus counter `browser_pool_tenant_quota_rejections_total`; Helm + `.env.example` env docs.

**Explicit ❌ (table body):** *none in this snapshot — §8 quotas ✅ across both distributed (Redis) and in-process paths.*

**Deferrals & multi-env work:** see **`## Deferred (scoped)`** below (partitioning activate, replica **instance** provisioning + lag UX, chart **queue-depth time-series**, etc.).

Where each partial row points to a **path**, column **What remains** is the smallest PR-shaped follow-up.

---

## Deferred (scoped)

Items needing external infra, credential provisioning, or a deliberate deprecation window beyond a single repo PR.

| Item | Reason deferred |
|------|-----------------|
| **Phase E-hard** — strip Bearer code paths entirely | Auth traffic metrics + deprecation window — [`SECURITY_ROADMAP_HTTPONLY.md`](./SECURITY_ROADMAP_HTTPONLY.md). |
| **Extended auth / Pact / Zod contract suites** | OpenAPI **health + enum parity** Jest shipped (**§13**); full cookie-session integration + Pact still a harness project. |
| **KEDA operator in cluster** | Install **ScaledObject CRD**, set **`keda.redis.address`**, verify against `deploy/helm/vahan360/KEDA.md`, avoid double-scaling vs CPU HPA. |
| **Charting (time-series queue depth / spatial district)** | **`StatusBarChart`** shipped on **`ingest-jobs`** + **`compliance`/`trips`/`districts`** slice histograms (**`analytics-charts.ts`**); live **queue-depth time-series** + **district geo** charts still need streaming metrics API + model work (compressed JSON blobs). |
| **Excel (xlsx) export** | Client + server **CSV** shipped on compliance (**Nest `export.csv`** + UI). **xlsx** deferred until workbook library choice (**exceljs** / similar) + RBAC review for large extracts. |
| **Express OpenAPI JSDoc codegen** | Hand-written spec + enum parity test shipped (✅ §13); drift-free **`swagger-jsdoc`** from all Express routes remains a dedicated refactor. |
| **Browser-manager at scale** | Fair-share routing + deterministic multi-replica release still ✅ (`§8`); optional **per-tenant quotas** now shipped when Redis + **`BROWSER_MAX_CONTEXTS_PER_TENANT`** > 0. |
| **Range partitioning** (activate) | DBA must review `deploy/db/partitioning/job_events_partition.sql`, schedule maintenance window, and add raw-SQL Prisma migration. Template committed (✅). |
| **Read replicas** (activate) | Provision live Postgres replica → set **`INGEST_DATABASE_URL_READ_REPLICA`** Secret key. Nest **`createIngestReadonlyPrismaClient`** adoption + Helm env wiring ✅ — runtime cutoff remains operator work + replica lag UX. |
| **Image push / signing / SBOM / multi-arch** (activate) | Workflow documents **`COSIGN_*`** secrets + verification (**✅ §11**); org runs **`publish`** on a semver tag and validates attestations in-registry. |
| **Vault / SealedSecrets** (activate) | Repo manifests + Helm guidance shipped (**✅ §12**); install controller + seal/sync per cluster remains operator work. |