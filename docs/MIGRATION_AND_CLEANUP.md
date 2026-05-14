# Migration & cleanup checklist

Phased work aligned with the enterprise spec. Items marked **DOC ONLY** are intentionally not implemented in a single pass; track them as separate PRs.

## Completed (verified in repo — conservative)

Only items with clear code or chart artifacts in this workspace (not “production deployed” claims):

- [x] **Express → Nest `/api/v2` proxy** — `http-proxy-middleware` on `/api/v2` when `API_V2_PROXY_ENABLED`, `pathRewrite` strips `/api/v2`, forwards `authorization` / W3C trace / `x-request-id` (`apps/api-express/src/app.js`).
- [x] **Helm Nest slice** — optional `nest` Deployment + Service + probes; shared ConfigMap merges `NEST_INTERNAL_URL` when `nest.enabled` (`deploy/helm/vahan360/templates/deployment-nest.yaml`, `service-nest.yaml`, `configmap.yaml`, `values.yaml`).
- [x] **DLQ + retry queue wiring** — named DLQ/retry queues, worker DLQ enqueue when `INGEST_DLQ_ENABLED`, metrics + Bull Board adapters include DLQ/retry (`apps/worker-ingest`, `apps/api-express/src/lib/ingestQueue.js`, `bullBoardAdmin.js`).
- [x] **HTTP DLQ replay (operator)** — `POST /api/v1/admin/queues/retry-replay` behind `ADMIN_QUEUE_REPLAY_ENABLED` + `X-Admin-Token` (still needs JWT on the route) (`apps/api-express/src/routes/adminQueues.js`).
- [x] **Optional OpenTelemetry** — gated `telemetry.js` on **api-express** and **worker-ingest** (`OTEL_ENABLED`, OTLP HTTP exporter).
- [x] **Queue depth samples in Postgres** — worker writes `system.queue_metrics` on an interval (`QUEUE_METRICS_INTERVAL_MS`).
- [x] **Compose nginx as API gateway only** — root `404`, `/api/` to Express; no static site in this nginx image path (`nginx/nginx.conf`).
- [x] **Stale root Mongo TODO snippet removed** — per Phase D checklist item.

## Phase A — Puppeteer → async ingest (incremental)

- [ ] Inventory all callers of `apps/api-express/src/services/browserAutomationService.js`, `apps/api-express/src/routes/legacyBrowserAutomation.js` (HTTP mount **`/api/selenium`** — legacy name), and any direct fetches to **`/api/selenium/*`**.
- [ ] For each flow, add an equivalent `POST /api/v1/scrape-jobs` kind + worker-side handler; keep legacy route returning **410** when `LEGACY_PUPPETEER_ENABLED=false`.
- [ ] Remove **`playwright`** from `api-express` only after **every** production path uses the queue and the legacy mount is deleted (grep `puppeteer` / `legacyBrowserAutomation` / `api/selenium` in CI as appropriate).
- [ ] Update operator runbooks: no long-lived HTTP for scrapes; poll job status or SSE.

## Phase B — Browser auth & tokens (httpOnly + CSRF)

**DOC ONLY / large PR — do not half-ship.**

- [ ] Replace `localStorage` / `sessionStorage` JWT storage in Next with **httpOnly** cookies set by the backend (or BFF).
- [ ] Add CSRF protection for cookie-authenticated mutating requests (double-submit cookie or synchronizer token).
- [ ] Refresh-token rotation + revocation table (or opaque server-side sessions).
- [ ] E2E tests for login, refresh, logout, CORS/credentials.

## Phase C — `nginx/` folder hygiene

- [ ] Treat `nginx/` as **templated** reverse-proxy config (TLS termination, upstream to Next + Express, SSE buffering flags).
- [x] Remove committed **bundled static assets** under `nginx/html`; the compose nginx now acts as an API gateway only.
- [ ] Document `proxy_read_timeout` / SSE for `/api/v1/scrape-jobs/*/stream`.

## Phase D — Mongo remnants

- [x] Delete the stale root `TODO.md` Mongo env snippet.
- [ ] `grep -r "mongodb\|mongoose\|MONGODB_URI" --exclude-dir=node_modules .` and delete dead scripts or gate behind `legacy/` with README warnings.
- [ ] Ensure runtime paths never require Mongo (current backend uses Postgres Prisma for auth).

## Phase E — Nest takeover of `/api/v2`

- [ ] Route new **control-plane** APIs in `apps/api-nest` behind `/api/v2` (already proxied when `API_V2_PROXY_ENABLED`).
- [ ] Define Nest auth (API keys / service JWT) independent of Express user JWT for cross-service calls.
- [ ] Gradually move read-heavy or new domains from Express to Nest; keep Express for stable `v1` until deprecated.

## Phase F — Queue / ops hardening (partially done in repo)

- [x] Dedicated DLQ queue name + env `INGEST_DLQ_ENABLED` (worker pushes on terminal Bull failure).
- [x] Retry queue name registered (no default consumer) for future manual replay.
- [ ] Optional: consumer on `scrape-ingest-retry` that re-adds to master with backoff (design TBD).
- [ ] Alerting on DLQ depth + failed job rate (Prometheus / Grafana rules).

## Verification commands

```bash
pnpm turbo run build
pnpm --filter @vahan360/api-express test
```

Use `curl` examples in root `README.md` for scrape job lifecycle and queue metrics API.

## Next milestones

- **Cookie auth (httpOnly)** — Next.js + backend session or BFF; CSRF for mutating routes (see Phase B above).
- **Legacy in-API browser automation removal** — finish async ingest paths, **`LEGACY_PUPPETEER_ENABLED=false`**, then delete `legacyBrowserAutomation.js` / `browserAutomationService.js` and drop **`playwright`** from `api-express` (Phase A; `docs/PUPPETEER_SUNSET_PLAN.md`). **`/api/selenium`** remains a legacy URL prefix until then.
- **Prisma-backed vehicle APIs** — replace Nest **`/vehicle/*`** stubs with real reads from the intelligence / events schema once modeled.
