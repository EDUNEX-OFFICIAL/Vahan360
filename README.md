# Vahan360

Monorepo for the Vahan360 ingest + control plane.

```
apps/                      Deployable services only — each has its own Dockerfile under apps/<svc>/Dockerfile
  api-express/             Express 4 control-plane API (Node 20)
  api-nest/                NestJS experimental health API (standalone; see **Nest control-plane** below)
  web/                     Next.js dashboard
  worker-ingest/           BullMQ worker + optional Playwright smoke + browser pool re-export
packages/                  Shared libraries only — workspace deps under `@vahan360/*`
  browser-pool/            In-process Playwright acquireContext / releaseContext (skeleton)
  contracts/               TS scrape-job + job-event contract types
  db/                      Prisma: ingest + processed + system schemas
  scraper-core/            Selector registry + Playwright smoke
deploy/                    Cluster / infra manifests (Helm, Argo CD, k8s, standalone compose, scrape configs)
  helm/vahan360/           Helm chart (web, api, worker, optional Nest, optional Redis, Ingress, HPA)
  argocd/                  Example Argo CD Application (commented)
  k8s/                     `namespaces.yaml` (single ns) + `namespaces-example.yaml` (commented multi-ns ideas)
  compose/                 Standalone observability compose (profiles `obs-loki`, `obs-otel`)
  grafana/                 Starter Grafana dashboards (JSON; import into Grafana 10+)
  prometheus/              Sample scrape config + alerting rules (Express /metrics + worker /metrics)
  loki/                    Minimal Loki config (compose profile `obs-loki`)
  promtail/                Docker log scrape → Loki
  caddy/                   Caddyfile for root `docker-compose.yml` reverse proxy (TLS optional via `CADDY_DOMAIN`)
docker/                    Dev notes only (`docker/postgres/README.md` — pgAdmin / local DB reset tips)
nginx/                     Legacy nginx snippets (root compose uses **Caddy** in `deploy/caddy/`)
docs/                      Architecture / migration / audit / API contract / scaling docs
docker-compose.yml         Postgres 15432, Redis, api-express, web, **caddy**; profiles `obs` (Prom+Grafana), `obs-loki` (Loki+Promtail)
ARCHITECTURE.md            Service map, Prisma schema split, queue mermaid, security/scaling notes
.github/workflows/ci.yml   Build, Prisma validate, Helm lint/template, Nest Docker build (no push)
turbo.json / pnpm-workspace.yaml   Turborepo pipeline (build/lint/dev/test/start) + workspace globs (`apps/*`, `packages/*`)
```

> **Convention:** runnable services live under **`apps/*`**, reusable workspace libraries under **`packages/*`**, and cluster/infra assets under **`deploy/*`** (plus the root `docker-compose.yml`, `deploy/caddy/`, optional legacy `nginx/`, and `docker/` dev notes). Root compose **`caddy`** proxies **`/` → web** and **`/api/*` → api-express** (set **`CADDY_DOMAIN`** on the VPS for HTTPS). New services should add a folder under `apps/` with its own `Dockerfile` referenced from compose / CI / Helm — keep packages free of Dockerfiles.

**Why some folders sit next to `apps/` (not inside it):** `deploy/`, `docs/`, `nginx/` (legacy), and root compose files are **infrastructure and documentation**, not shipped Node services. The runnable UI and APIs live under **`apps/web`**, **`apps/api-express`**, **`apps/api-nest`**, and **`apps/worker-ingest`**. For a table + glossary (control plane vs Nest v2, dual Prisma), see **`ARCHITECTURE.md`** (“Repo layout” / “Glossary”).

## Running locally

### Prereqs
- Node 20+
- pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- Docker (for postgres + redis), or local installs

### 1. Boot infra

```bash
# Postgres + Redis from the bundled compose file (adjust ports if needed).
docker compose -f docker-compose.yml up -d postgres redis
```

Host Postgres is published on **5433** (not 5432) so it does not clash with a local PostgreSQL install. Point `DATABASE_URL` at `127.0.0.1:5433`.

If you already have postgres/redis running, just set the connection URLs below.

### 2. Bootstrap workspace

```bash
pnpm install
pnpm turbo run build          # contracts, db (prisma generate), scraper-core, browser-pool, …
pnpm --filter @vahan360/db db:migrate:deploy   # ingest + processed + system migrations
```

The ingest migration **does not** create Express `public` tables (`users`, `khanan_data`, …). Those come from `apps/api-express/prisma/schema.prisma`. After `apps/api-express/.env` has a working `DATABASE_URL`:

```bash
pnpm --filter @vahan360/api-express run prisma:push   # syncs public schema (users, etc.)
# Fresh/local DB: if Prisma warns about `roles` rebuild (data loss), use instead:
# pnpm --filter @vahan360/api-express run prisma:push:dev
pnpm --filter @vahan360/api-express run sync:user     # default admin / admin123
```

### 3. Run services

```bash
# .env files: copy and tweak per service
cp apps/api-express/.env.example apps/api-express/.env
cp apps/worker-ingest/.env.example apps/worker-ingest/.env

# Tab 1 — control-plane API
pnpm --filter @vahan360/api-express dev

# Tab 2 — BullMQ ingest worker (Phase 4)
pnpm --filter @vahan360/worker-ingest start

# Tab 3 — optional frontend (set NEXT_PUBLIC_API_BASE_URL to the same host:port as the API)
cp apps/web/.env.example apps/web/.env.local   # then edit URL if backend is not :5000
pnpm --filter @vahan360/web dev
```

### Nest control-plane (experimental)

Standalone **NestJS** app at `apps/api-nest` (`@vahan360/api-nest` package). It does **not** replace Express today — `GET /health`, `GET /control/status` (service name, `package.json` version, process uptime, Node version — no secrets), and room for future `/api/v2`-style routes.

```bash
pnpm --filter @vahan360/api-nest run start:dev   # hot reload (same as `pnpm --filter @vahan360/api-nest dev`)
# or production-style after build:
pnpm --filter @vahan360/api-nest run build && pnpm --filter @vahan360/api-nest start
```

Default listen port **`4000`**; override with **`NEST_API_PORT`**. Example:

```bash
curl -sS http://localhost:4000/health
# {"status":"ok","service":"vahan360-api-nest","ts":"..."}

curl -sS http://localhost:4000/control/status
# {"service":"vahan360-api-nest","version":"0.0.0","uptime":…,"node":"v20.…"}
```

**Express bridge (`vahan360-api-express`):** with `API_V2_PROXY_ENABLED=1` (or `true`) in `apps/api-express/.env`, Express mounts **`/api/v2`** → **`NEST_INTERNAL_URL`** (default `http://127.0.0.1:4000`), stripping the `/api/v2` prefix. Examples: `GET /api/v2/health` → Nest `GET /health`; `GET /api/v2/control/status` → Nest `GET /control/status`. Incoming **`x-request-id`**, **`traceparent`**, **`tracestate`**, and **`authorization`** are forwarded to Nest when present. When the flag is off, `/api/v2` is not registered (404). **Security:** do not expose this path on the public internet without network controls — Nest has its own auth story; this proxy is not behind the Express JWT used for `/api/v1/*`.

```bash
# Enable proxy in apps/api-express/.env first: API_V2_PROXY_ENABLED=1 and a running Nest on NEST_INTERNAL_URL.
curl -sS http://localhost:5000/api/v2/health
curl -sS http://localhost:5000/api/v2/control/status
```

**Login / `POST /api/auth/generate-token`:** the Next app defaults to `http://localhost:5000`. If the API listens elsewhere, set `NEXT_PUBLIC_API_BASE_URL` in `apps/web/.env.local` — e.g. `http://localhost:5001` when `BACKEND_PORT=5001`, or `http://localhost:3001` when using the `docker-compose.yml` backend publish mapping.

### 4. Smoke the queue

```bash
# Enqueue a stub job (auth required — get a token via /auth/login first).
curl -X POST http://localhost:5000/api/v1/scrape-jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-request-id: test-123" \
  -H "Idempotency-Key: demo-1" \
  -d '{"kind":"khanan_date_range","correlationId":"demo-1","fromDate":"01-01-2026","toDate":"01-01-2026"}'

# Poll
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/scrape-jobs/<id>
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/v1/scrape-jobs/<id>/events?limit=50"

# Server-Sent Events (job snapshot once, then job_event rows + heartbeats)
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/v1/scrape-jobs/<id>/stream"
```

## Phase 5 — Playwright smoke

The worker can run a one-shot Playwright probe before processing a job. It is
**off by default** so CI / browser-free boxes stay green.

```bash
# In apps/worker-ingest/.env
PLAYWRIGHT_ENABLED=true
PLAYWRIGHT_SMOKE_URL=https://example.com
PLAYWRIGHT_TIMEOUT_MS=20000

# One-time browser install (chromium ~150MB):
pnpm --filter @vahan360/worker-ingest run playwright:install
```

When the gate is on, each master job emits an extra `scrape.smoke.ok` (or
`scrape.smoke.failed`) row in `ingest.job_events` with page title, final URL,
load time, and the selector-registry validation result.

Selector registries live in `packages/scraper-core/portals/*.yaml`; bump
`version:` whenever a portal's HTML changes.

## Environment variables

| Variable | Service | Purpose | Default |
| --- | --- | --- | --- |
| `DATABASE_URL` | backend / db / worker | Postgres (single DB: `public` + `ingest` + `processed` + `system`) | — |
| `INGEST_DATABASE_URL` | backend / worker | Optional dedicated URL for the `ingest` schema | falls back to `DATABASE_URL` |
| `JWT_SECRET` | backend | ≥32 chars in production; rotates invalidate sessions | — |
| `BACKEND_PORT` | backend | Express port | `5000` |
| `NEST_API_PORT` | `@vahan360/api-nest` (Nest) | HTTP port for the experimental Nest app | `4000` |
| `API_V2_PROXY_ENABLED` | `vahan360-api-express` | When `1`/`true`, mount `/api/v2` → `NEST_INTERNAL_URL` (path prefix stripped) | unset / off |
| `NEST_INTERNAL_URL` | `vahan360-api-express` | Upstream base URL for the `/api/v2` proxy (Nest) | `http://127.0.0.1:4000` locally; Helm sets `http://<fullname>-nest:4000` when **`nest.enabled`** (unless **`nest.internalUrl`**) |
| `CORS_ORIGIN` | backend | Comma-separated allowed browser origins (production). Dev defaults to reflecting the request `Origin`. | unset → permissive dev |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | Base URL for API calls (`/login`, dashboards) | `http://localhost:5000` in `.env.example` |
| `REDIS_URL` / `BULLMQ_REDIS_URL` | backend / worker | BullMQ Redis URL | — (poller stub used when unset) |
| `REDIS_CACHE_ENABLED` | `vahan360-api-express` | When `true`/`1` and one of `REDIS_URL` / `BULLMQ_REDIS_URL` is set, enables read-through cache for hot GETs (currently `GET /api/v1/queues/metrics` with **TTL 5s** keyed by path + clamped `limit`). Cache failures degrade to fresh reads; response header **`x-cache`** = `hit` / `miss` / `disabled`. | `false` |
| `INGEST_QUEUE_NAME` | backend / worker | Master queue name | `scrape-ingest` |
| `INGEST_CHILD_QUEUE_NAME` | worker | Child queue name | `scrape-ingest-child` |
| `INGEST_FANOUT_ALL_CHILD_TYPES` | worker | When `true`/`1`, master also enqueues **one child per** `INGEST_CHILD_JOB_TYPES` (see contracts); default **`false`** — high Redis/queue pressure | `false` |
| `INGEST_DLQ_QUEUE_NAME` | backend / worker | Dead-letter queue name (Bull Board + worker) | `scrape-ingest-dlq` |
| `INGEST_RETRY_QUEUE_NAME` | backend / worker | Retry fan-in queue (Bull Board + optional retry **Worker**) | `scrape-ingest-retry` |
| `INGEST_RETRY_WORKER_ENABLED` | worker | When `true`/`1`, consume **`scrape-ingest-retry`** and re-`Queue.add` to master/child | `false` |
| `INGEST_RETRY_MAX_REPLAYS` | worker / backend | Max **`replayAttempts`** before skip (HTTP admin + retry worker); invalid/≤0 → **5** | `5` |
| `INGEST_RETRY_WORKER_CONCURRENCY` | worker | BullMQ concurrency for the retry **Worker** | `2` |
| `ADMIN_QUEUE_REPLAY_ENABLED` | backend | When `true`/`1`, expose **`POST /api/v1/admin/queues/retry-replay`** (still needs JWT + **`X-Admin-Token`**) | `false` |
| `ADMIN_QUEUE_TOKEN` | backend | Shared secret for **`X-Admin-Token`** on admin queue routes | — |
| `OPENAPI_ENABLED` | `@vahan360/api-nest` | When `true`/`1`, mount Swagger UI at **`/docs`** | `false` |
| `INGEST_DLQ_ENABLED` | worker | When `true`/`1`, terminal master/child failures `Queue.add` to DLQ with `failedReason` + `dlqMeta` | `false` |
| `BULLMQ_LOCK_DURATION_MS` | worker | BullMQ `lockDuration` (ms), min `5000` if set | unset (library default) |
| `BULLMQ_STALLED_INTERVAL_MS` | worker | BullMQ `stalledInterval` (ms), min `5000` if set | unset |
| `WORKER_METRICS_PORT` | worker | Prometheus scrape port when `METRICS_ENABLED` on worker | `9101` |
| `RATE_LIMIT_SCRAPE_MAX` | backend | Max `POST /api/v1/scrape-jobs` per IP **and** per user (when JWT) per window | `30` |
| `RATE_LIMIT_WINDOW_MS` | backend | Window for scrape enqueue limiters (ms) | `60000` |
| `TRUST_PROXY` | backend | When `true`/`1`, sets Express **`trust proxy`** so **`req.ip`** and scrape rate-limit keys follow **`X-Forwarded-For`** behind ingress | unset / off |
| `TRUST_PROXY_HOPS` | backend | Number of trusted reverse-proxy hops for **`app.set('trust proxy', n)`** when **`TRUST_PROXY`** is on | `1` |
| `RATE_LIMIT_GLOBAL_MAX` | backend | Optional global requests/IP cap (all routes); off when unset/`0` | unset |
| `RATE_LIMIT_GLOBAL_WINDOW_MS` | backend | Window for global limiter (ms) | `900000` |
| `QUEUE_METRICS_INTERVAL_MS` | worker | BullMQ `getJobCounts` → `system.queue_metrics` interval | `30000` |
| `BULL_BOARD_ENABLED` | backend | Mount Bull Board at `/admin/queues` | `false` |
| `BULL_BOARD_ALLOWLIST_CSV` | backend | Optional comma-separated IPs for Bull Board | unset → any IP (still needs JWT) |
| `NEXT_PUBLIC_BULL_BOARD_URL` | frontend | Optional scrape-console link to Bull Board | unset |
| `INGEST_WORKER_CONCURRENCY` | worker | Master concurrency | `2` |
| `INGEST_CHILD_CONCURRENCY` | worker | Child concurrency | `4` |

**`INGEST_FANOUT_ALL_CHILD_TYPES`:** Normal runs enqueue two child steps only. With this flag, each master job adds **N** extra children (N = length of `INGEST_CHILD_JOB_TYPES` in `@vahan360/contracts`, currently 11 portal/slice discriminators). Prefer **lower** `INGEST_CHILD_CONCURRENCY` (e.g. 2–4), more worker replicas, and headroom on Redis/Postgres before enabling in production; the worker logs **`ingest.master.fanout_all_child_types`** once per master job when the path is active.
| `INGEST_JOB_POLLER` | backend | Dev stub poller (only used when Redis unset) | `0` |
| `INGEST_JOB_POLL_INTERVAL_MS` | backend | Poller tick interval | `5000` |
| `PLAYWRIGHT_ENABLED` | worker | Enable Phase 5 smoke gate | `false` |
| `PLAYWRIGHT_SMOKE_URL` | worker | URL the smoke probe navigates to | — |
| `PLAYWRIGHT_TIMEOUT_MS` | worker | Navigation timeout | `20000` |
| `SCRAPER_PORTALS_DIR` | worker | Override portal YAML directory | bundled `portals/` |
| `METRICS_ENABLED` | backend / worker | Backend: `GET /metrics`. Worker: starts `GET /metrics` on `WORKER_METRICS_PORT` | `false` |
| `ENV_STRICT` | backend | When `true`/`1`, invalid critical env fails startup (`zod` in `src/config/envSchema.js`) | unset → warn-only |
| `HELMET_DISABLE_CSP` | backend | When `true`/`1`, disables Helmet `Content-Security-Policy` (dev / SSE behind proxies) | unset |
| `SCRAPE_MAX_RANGE_DAYS` | backend | Max inclusive calendar span validated for **`POST /api/v1/scrape-jobs`** (`kind: khanan_date_range`) | `31` |
| `SCRAPE_JOB_SSE_POLL_MS` | backend | SSE stream poll for new `job_events` | `2000` |
| `SCRAPE_JOB_SSE_HEARTBEAT_MS` | backend | SSE `: ping` interval | `15000` |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | CI / install | Skip chromium download on install | `1` (CI) |
| `BROWSER_POOL_MAX` | worker / pool | Max concurrent Playwright contexts (in-process) | `2` |
| `ATTACH_REQUEST_ID_TO_JSON` | backend | When `true`, every `res.json` body includes `requestId` | `false` (4xx/5xx still get `requestId` in JSON by default) |
| `OTEL_ENABLED` | backend / worker | When `true`/`1`, loads OpenTelemetry SDK + OTLP HTTP trace exporter | `false` (unset) |
| `OTEL_SERVICE_NAME` | backend / worker | `service.name` on exported spans | backend: `vahan360-api-express`, worker: `worker-ingest` (set in `telemetry.js` if unset) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | backend / worker | OTLP base URL for traces (HTTP); exporter sends to `…/v1/traces` | `http://127.0.0.1:4318` when neither this nor `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | backend / worker | Full traces ingest URL (overrides base endpoint for traces only) | — |

No secrets are committed. `.env.example` files document everything above; copy
them to `.env` before booting a service.

## Kubernetes — namespaces

- **Single namespace (default chart flow):** `kubectl apply -f deploy/k8s/namespaces.yaml` then `helm install --namespace vahan360 …` (see `deploy/helm/vahan360`).
- **Multi-namespace sketch (comments only):** `deploy/k8s/namespaces-example.yaml` — uncomment blocks if your platform splits **frontend / backend / scraper / database / monitoring**; the chart itself stays single-namespace compatible.

## Architecture & migrations

- **`ARCHITECTURE.md`** — service map, Prisma schema split, queue mermaid, security/scaling notes.
- **`docs/MIGRATION_AND_CLEANUP.md`** — phased checklist (Puppeteer removal, httpOnly auth, nginx, Mongo grep, Nest `/api/v2`).

## API surface (Phase 6 lite)

- `POST /api/v1/scrape-jobs` — enqueue (idempotent via `Idempotency-Key`)
- `GET  /api/v1/scrape-jobs/:id` — row + last 5 events + aggregated progress
- `GET  /api/v1/scrape-jobs/:id/events?cursor=&limit=` — newest-first paginated
- `GET  /api/v1/scrape-jobs/:id/stream` — SSE progress (`job`, `job_event`, `: ping` heartbeats)
- `GET  /api/v1/queues/metrics?limit=50` — recent `system.queue_metrics` snapshots (JWT)
- `POST /api/v1/admin/queues/retry-replay` — optional DLQ → master/child replay (**JWT** + **`ADMIN_QUEUE_REPLAY_ENABLED=true`** + header **`X-Admin-Token`** = **`ADMIN_QUEUE_TOKEN`**); see **Ingest retry / DLQ replay** below
- `GET  /admin/queues` — Bull Board UI when `BULL_BOARD_ENABLED=true` (JWT + optional IP allowlist)
- `GET  /metrics` — Prometheus exposition (when `METRICS_ENABLED=true`)
- `GET  /health` — liveness; reports `metricsEnabled` and contract size
- `GET  /api/health/pg` — Postgres connectivity probe
- Khanan date-range scraping is **only** via **`POST /api/v1/scrape-jobs`** (`kind: khanan_date_range`); workers consume BullMQ — there is no in-API browser mount on Express.

## Rate limits & queue metrics

- **`POST /api/v1/scrape-jobs`** — `express-rate-limit`: **per-IP** bucket (always) plus **per-username** bucket when a JWT is present (`RATE_LIMIT_SCRAPE_MAX` / `RATE_LIMIT_WINDOW_MS`, defaults **30** per **60s**). HTTP **429** responses include JSON **`requestId`** (and `X-Request-Id` header). Optional **global** soft limit: set **`RATE_LIMIT_GLOBAL_MAX`** (and optional **`RATE_LIMIT_GLOBAL_WINDOW_MS`**) to cap total requests per IP across all routes after `requestContext` runs. Optional JSON **`priority`** **1–10** (integer): stored on **`ingest.scrape_jobs.priority`** and passed to BullMQ (**larger** = higher queue priority). Behind ingress, set **`TRUST_PROXY`** so per-IP limits use the forwarded client IP.
- **`system.queue_metrics`** — `@vahan360/worker-ingest` records BullMQ **`getJobCounts()`** for **master**, **child**, **`scrape-ingest-dlq`**, and **`scrape-ingest-retry`** (names override via env) on a timer (**`QUEUE_METRICS_INTERVAL_MS`**, default **30s**). Each row stores **`queue_name`**, **`recorded_at`**, and a **`sample`** JSON blob with **`takenAt`**, raw **`jobCounts`**, and a derived **`depth`** (waiting + delayed + active + prioritized).
- **DLQ** — when **`INGEST_DLQ_ENABLED=true`**, terminal failures on master/child are **`Queue.add`**'d to the DLQ with the original job payload plus **`failedReason`** and **`dlqMeta`** (source queue, Bull job id, timestamps).
- **Retry queue consumer** — set **`INGEST_RETRY_WORKER_ENABLED=true`** on **`@vahan360/worker-ingest`** to run a BullMQ **`Worker`** on **`scrape-ingest-retry`** (override via **`INGEST_RETRY_QUEUE_NAME`**). Jobs are de-duplicated with **`failedReason` / `dlqMeta` / `target`** stripped, then re-queued to **child** when **`target: 'child'`** else **master**. **`replayAttempts`** increments on each pass; **`INGEST_RETRY_MAX_REPLAYS`** (default **5**, invalid or ≤0 falls back to **5**) blocks further fan-out when the cap is reached. Prometheus: **`ingest_retry_replayed_total{target="master|child"}`** when **`METRICS_ENABLED=true`**. Tune concurrency with **`INGEST_RETRY_WORKER_CONCURRENCY`** (default **2**).
- **Child ingest adaptive throttle (optional)** — after each **terminal** BullMQ failure on the **child** queue, the worker can `sleep` for `min(INGEST_BACKOFF_BASE_MS * INGEST_BACKOFF_MULTIPLIER ** consecutiveFailures, INGEST_BACKOFF_MAX_MS)` when **`INGEST_BACKOFF_BASE_MS` > 0** (default **0** = disabled). A module counter tracks consecutive terminal child failures and resets to **0** on a successful child job. Structured log field **`backoffMs`** is emitted on apply (`msg: ingest.child.backoff`). See **`apps/worker-ingest/.env.example`**.
- **DLQ HTTP replay (optional)** — **`POST /api/v1/admin/queues/retry-replay`** with JSON **`{ "bullJobId": "<id>", "queue": "dlq" }`** uses the same routing rules as the retry worker, increments **`replayAttempts`**, **`Queue.add`**'s to master or child, then **`remove()`**'s the DLQ job (best-effort). **Operational risks:** duplicate **`jobId`** if a master row with the same **`scrapeJobId`** is still active (HTTP **409**); mis-routed **`target`** can loop work — keep **`ADMIN_QUEUE_TOKEN`** long and secret; leave **`ADMIN_QUEUE_REPLAY_ENABLED`** off in prod unless needed.
- **Nest OpenAPI** — on **`@vahan360/api-nest`**, set **`OPENAPI_ENABLED=true`** to serve Swagger UI at **`http://<nest-host>:4000/docs`** (not under **`/api/v2`** unless you add a separate proxy rule).
- **Read API** — `GET /api/v1/queues/metrics?limit=50` returns the latest rows plus **`latestByQueue`** (one newest row per queue name). When **`REDIS_CACHE_ENABLED=true`** and a Redis URL is configured, the route is served from a **5s** TTL cache keyed by `path + clamped limit`; the **`x-cache`** response header surfaces `hit` / `miss` / `disabled`.

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/v1/queues/metrics?limit=50" | jq .
```

- **Bull Board** — set **`BULL_BOARD_ENABLED=true`** and Redis URLs so the backend can open read-only BullMQ `Queue` handles for **master**, **child**, **DLQ**, and **retry** queues. Optional **`BULL_BOARD_ALLOWLIST_CSV`** restricts by **`req.ip`**. The Next scrape console can show an **“Open Bull Board”** link when **`NEXT_PUBLIC_BULL_BOARD_URL`** is set (e.g. `http://localhost:5000/admin/queues`).

## Distributed tracing / logs (request id + Loki + optional OpenTelemetry)

- **Request id:** Send `x-request-id` (any short string) on API calls; the backend echoes it as **`X-Request-Id`** and stores it on `req.requestId`. If omitted, the server generates a UUID (v4). Structured logs are one JSON object per line on stdout (`service: vahan360-api-express` or `worker-ingest`), e.g. after `POST /api/v1/scrape-jobs` you should see `msg: "scrape_job.accepted"` with `requestId`, `jobId`, `kind`. BullMQ job payloads include `requestId` when present so the worker can log the same correlation id.
- **OpenTelemetry (optional):** Set `OTEL_ENABLED=true` on the backend and/or worker. Traces export over **OTLP HTTP** (defaults: `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`, `OTEL_SERVICE_NAME` per package). `@opentelemetry/auto-instrumentations-node` patches Node `http` (incoming), Express, and other common libs — incoming **`traceparent` / `tracestate`** are honored by the HTTP server instrumentation. Structured JSON logs automatically include **`traceId`**, **`trace_id`**, and **`span_id`** when a span is active; `req.traceId` is set from the active span for request-scoped code.
- **JSON bodies:** Error responses (HTTP ≥ 400) automatically include `requestId` in the JSON body. Set `ATTACH_REQUEST_ID_TO_JSON=true` to also append `requestId` to successful JSON responses.
- **Loki (Docker Compose):** From the repo root on Windows (PowerShell or Git Bash), after `cd` into the repo folder (example: `cd C:\Users\you\src\Vahan360`):
  ```bash
  docker compose -f docker-compose.yml --profile obs-loki up -d loki promtail
  ```
  Loki UI/API: `http://localhost:3100`. **Promtail** needs the Docker engine’s Linux socket (`/var/run/docker.sock` inside the container); this matches **Docker Desktop** on Windows. To ship logs from a host-only apps/api-express/worker process, run a Promtail with a `static_configs` `__path__` to your log files, or point Grafana Agent / OTel instead — see `deploy/promtail/promtail-config.yml` as a starting point.
- **Standalone stack:** `deploy/compose/observability.docker-compose.yml` supports the same **`--profile obs-loki`** for `loki` and `promtail` (paths in that file are relative to `deploy/compose/`).

### Jaeger + OTLP locally (profile `obs-otel`)

**Jaeger all-in-one** accepts OTLP on **4318** (HTTP) and **4317** (gRPC) and serves the UI on **16686** — no separate OpenTelemetry Collector YAML is required for local dev.

```bash
docker compose -f deploy/compose/observability.docker-compose.yml --profile obs-otel up -d jaeger
```

Then set `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` in `apps/api-express/.env` and/or `apps/worker-ingest/.env` (service names default to `vahan360-api-express` and `worker-ingest`). Open **http://localhost:16686** in the browser. CI does **not** start Jaeger; leave `OTEL_ENABLED` unset there.

### Distributed traces across API and worker

Scrape-ingest jobs carry the **same trace** as the API handler that enqueued them:

- **Backend** (`apps/api-express/src/lib/ingestQueue.js` → `enqueueScrapeIngestJob`): when `OTEL_ENABLED` is true and an HTTP (or other) span is active, `propagation.inject` adds **`traceparent`** and, if present, **`tracestate`** onto BullMQ `job.data` (alongside `scrapeJobId`, `kind`, `correlationId`, optional `requestId`).
- **Worker** (`apps/worker-ingest/src/index.js`): before `processMasterJob` / `processChildJob`, `runWithJobTraceContext` (`apps/worker-ingest/src/lib/runWithJobTraceContext.js`) runs `propagation.extract` from those fields and **`context.with(...)`** so structured logs pick up **`traceId`** / **`span_id`** and any auto-instrumented or manual spans attach under the API trace. Child jobs copy the same W3C fields from the master job. If `traceparent` is missing or OTEL is off, behavior matches the previous release.
- **Env:** enable **`OTEL_ENABLED=true`** (and the same **`OTEL_EXPORTER_OTLP_ENDPOINT`**, e.g. `http://127.0.0.1:4318`) on **both** backend and worker so spans reach one Jaeger; see **Jaeger + OTLP locally** above.

## Observability (Prometheus + Grafana)

- **Compose profile `obs`** (from repo root): starts Prometheus (9090) and Grafana (3002) alongside the main file. Example:
  ```bash
  docker compose --profile obs up -d prometheus grafana
  ```
  Point Prometheus at a host-reachable backend where `METRICS_ENABLED=true` and `/metrics` is exposed. The sample config lives in `deploy/prometheus/prometheus.yml` (default target `host.docker.internal:5000` for local backends). The same file includes a **`worker-ingest`** scrape job on **`host.docker.internal:9101`** (`WORKER_METRICS_PORT`); **enable `METRICS_ENABLED=true` on `apps/worker-ingest`** or scrapes will hit HTTP 404 — tune the target (e.g. `127.0.0.1:9101`) per your host OS if needed.
- **Compose profile `obs-loki`:** Loki (3100) + Promtail — see **Distributed tracing / logs** above; same root `docker-compose.yml` file.
- **Standalone file:** `deploy/compose/observability.docker-compose.yml` — Prometheus + Grafana; add `--profile obs-loki` for Loki + Promtail; add **`--profile obs-otel`** for Jaeger (see **Jaeger + OTLP locally** above).

## Kubernetes (Helm)

Chart path: `deploy/helm/vahan360`.

1. **Fetch subchart (optional Redis, off by default)**  
   ```bash
   cd deploy/helm/vahan360
   helm dependency update
   ```

2. **Render manifests (smoke, no cluster required)**  
   ```bash
   helm template vahan360-release . --namespace vahan360
   ```

3. **Install** — create a Secret named **`{release}-vahan360-secrets`** (see `helm template` output `...-secrets`; for `helm install rel .` it is usually `rel-vahan360-secrets`). Keys: `DATABASE_URL`, `JWT_SECRET`, and `REDIS_URL` unless `redis.enabled` is true.

   ```bash
   kubectl apply -f deploy/k8s/namespaces.yaml
   kubectl -n vahan360 create secret generic rel-vahan360-secrets \
     --from-literal=DATABASE_URL='postgresql://...' \
     --from-literal=JWT_SECRET='...' \
     --from-literal=REDIS_URL='redis://...'
   helm install rel . --namespace vahan360
   ```

- **Images:** override `web.image`, `api.image`, `worker.image`, and (when Nest is on) `nest.image` in a values file you pass with `-f`. Build images from the repo root, e.g. `docker build -f apps/worker-ingest/Dockerfile .` and `docker build -f apps/api-nest/Dockerfile .`
- **Ingress / HPA:** `ingress.enabled` and `hpa.enabled` default to `false`; set `ingress.enabled=true` and tune `ingress.hosts`.
- **Bundled Redis:** set `redis.enabled: true` in values to install the Bitnami subchart (dev only recommended).
- **`API_V2_PROXY_ENABLED` / `NEST_INTERNAL_URL`:** rendered into the shared `config` ConfigMap for the Express `api` pod. With **`nest.enabled: true`**, the chart sets **`NEST_INTERNAL_URL`** to **`http://<Helm fullname>-nest:4000`** automatically (override with **`nest.internalUrl`** if you need a custom URL). Turn on the proxy with **`config.API_V2_PROXY_ENABLED: "true"`** — see **Kubernetes: Nest + Express v2 proxy** below.
- **Browser-manager (Phase 1):** `browserManager.enabled: false` by default. When enabled, the chart deploys a tiny Node HTTP `ok` Deployment + Service on `:3005` (reusing the worker image with `command` override) as a placeholder until the real browser-manager binary lands. Override `browserManager.image.*` to point at a dedicated repo and replace `browserManager.command` with the real entrypoint when wiring.

Argo CD: see commented `deploy/argocd/application.example.yaml`.

### Kubernetes: Nest + Express v2 proxy

1. Build and push the Nest image (same `apps/api-nest` app as local `@vahan360/api-nest`): from repo root, `docker build -f apps/api-nest/Dockerfile .` — tag and push to your registry, then set **`nest.image.repository`** / **`nest.image.tag`** in values.
2. Enable the chart workload and proxy flags, e.g. in a `values-prod.yaml`:

   ```yaml
   nest:
     enabled: true
   config:
     API_V2_PROXY_ENABLED: "true"
   ```

   With **`nest.enabled: true`**, **`NEST_INTERNAL_URL`** in the shared ConfigMap becomes **`http://<release-fullname>-nest:4000`** so the Express pod targets the in-cluster Nest Service (unless **`nest.internalUrl`** is set).
3. Optional OpenTelemetry on the Nest pod only: non-secret keys under **`nest.otelEnv`** (e.g. `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`).
4. After deploy, from inside the cluster or via the same ingress host as the API, verify Nest is reachable through Express:

   ```bash
   curl -sS "https://<your-api-host>/api/v2/health"
   ```

   Expect the Nest **`/health`** JSON (same shape as `curl http://localhost:4000/health` locally). **`nest.enabled`** defaults to **`false`** so existing installs stay unchanged.

### Grafana dashboards

Starter dashboards live in **`deploy/grafana/dashboards/`** as JSON (Grafana 10+ import). Use **Dashboards → Import**, choose the **Prometheus** datasource when the **`datasource`** variable prompts you. **`vahan360-queue-depth.json`** charts **`scrape_jobs_status`**, **`scrape_jobs_enqueued_total`**, and **`scrape_jobs_completed_total`** (from **`METRICS_ENABLED`** + **`/metrics`**). **`vahan360-http-api.json`** documents missing HTTP histograms and includes placeholder PromQL plus **`nodejs_eventloop_lag_seconds`** from **`prom-client`** default metrics. For Prometheus-managed alerting, point your stack at **`deploy/prometheus/rules/vahan360-ingest.rules.yml`** (loaded via **`rule_files`** in **`deploy/prometheus/prometheus.yml`** when the whole **`deploy/prometheus/`** directory is mounted, e.g. compose profile **`obs`**).

## CI

`.github/workflows/ci.yml` runs `pnpm install`, `pnpm turbo run build` (includes **contracts**, **db**, **scraper-core**, **browser-pool**, **worker-ingest**, **vahan360-api-express**, **@vahan360/web**, and experimental **`@vahan360/api-nest`** Nest build), `prisma validate` on `@vahan360/db`, then **Helm** `dependency update`, `helm lint`, `helm template` (default values and **`--set nest.enabled=true`** smoke), **Docker build** of `apps/api-nest/Dockerfile` with **`push: false`**. Playwright browser download stays off in the default job; the optional `playwright-smoke` job remains gated with `if: false`.

## Legacy in-API browser automation — removed

- **Done:** Express no longer mounts **`/api/selenium`**; **`playwright`** was removed from **`@vahan360/api-express`**. The Khanan Soft dashboard enqueues **`POST /api/v1/scrape-jobs`** and polls job status. Historical planning notes: `docs/PUPPETEER_SUNSET_PLAN.md`.

## Security roadmap (JWT storage)

- **Ingress / rate limits:** when **`vahan360-api-express`** runs behind **Caddy**, nginx, or Kubernetes ingress, enable **`TRUST_PROXY=true`** (and tune **`TRUST_PROXY_HOPS`**) so **`express-rate-limit`** on **`POST /api/v1/scrape-jobs`** keys off the real client IP instead of the proxy. Set hops to match the number of trusted proxies only — too high allows **`X-Forwarded-For`** spoofing.
- **Today:** the Next app stores the JWT in **`localStorage`** (`spybot_token`) on several dashboard pages — convenient for SPA fetches but vulnerable to XSS exfiltration.
- **TODO:** migrate to **httpOnly**, **Secure**, **SameSite** cookies, CSRF tokens for mutating requests, and tighten CSP. A short `TODO` is left on the login page; no cookie stub is wired yet to avoid a half-baked auth split.

## What is intentionally **not** done in this pass

- **Helm** optional **Nest** Deployment (`nest.enabled`); full **Nest** migration of the Express backend is not done — experimental **`@vahan360/api-nest`** in `apps/api-nest` is a separate process you can run locally or in-cluster.
- Full **RBAC**, org tenancy, and fine-grained policy engines.
- Full **Grafana dashboards** (only sample Prometheus + optional Grafana / minimal Loki compose are wired).
- **Real portal scrapers** inside the worker beyond smoke + stubs; selector YAML is ready to extend.
- **Distributed** browser pool / RPC workers (only in-process `packages/browser-pool`).
- **Cookie-based auth** implementation (roadmap only).
