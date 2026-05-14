# Puppeteer sunset plan

> **Status:** Phase: **Playwright engine swap** — legacy `/api/selenium/*` is still mounted for URL stability; the in-API scraper now runs on **Playwright** (`browserAutomationService.js`). At least one frontend page (`apps/web/src/app/dashboard/khanansoft/page.tsx`) still calls `/api/selenium/*`; full retirement follows the steps below.
>
> Companion: [`./ENTERPRISE_COMPLETION_CHECKLIST.md`](./ENTERPRISE_COMPLETION_CHECKLIST.md) Section 5, [`./MIGRATION_AND_CLEANUP.md`](./MIGRATION_AND_CLEANUP.md) Phase A, and [`../README.md`](../README.md) → "Legacy Puppeteer — removal plan".

## Inventory (today)

| Surface | Where | Notes |
| --- | --- | --- |
| Express routes | `apps/api-express/src/routes/legacyBrowserAutomation.js` | **`LEGACY_ROUTE_MOUNT=/api/selenium`** (legacy URL prefix): `GET /by-date-range`, `POST /scrape-range`, `GET /status`, `POST /stop`, `GET /last-run`, `GET /dailyScraping`. Gated by `LEGACY_PUPPETEER_ENABLED` → **410 Gone** + `migration` hint when off. |
| Service | `apps/api-express/src/services/browserAutomationService.js` | Singleton in-process scraper (Playwright). `isCurrentlyRunning()`, `requestStop()`, `triggerDailyScraping()`, `scheduledScrapingTask()`, `getRunSummary()`, `getStatusMessage()`, `formatDate()`. |
| Dependency | `apps/api-express/package.json` — `"playwright"` | Browser download can be skipped in Docker via `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` + `PLAYWRIGHT_EXECUTABLE_PATH` / `PUPPETEER_EXECUTABLE_PATH` fallback. |
| Frontend caller | `apps/web/src/app/dashboard/khanansoft/page.tsx` | Only page still hitting `api/selenium/*`. |
| Async replacement | `POST /api/v1/scrape-jobs` (`apps/api-express/src/routes/scrapeJobs.js`) | Consumed by `apps/worker-ingest`; contract types in `packages/contracts/src/*` (`SCRAPE_JOB_KINDS`). |
| Worker handler for `khanan_date_range` | `apps/worker-ingest/src/index.js` (`KIND_TO_PORTAL` → `khanan-bihar`) | Real persistence is stub-grade today; Playwright smoke wired via `@vahan360/scraper-core`. |
| Helm default | `deploy/helm/vahan360/values.yaml` `LEGACY_PUPPETEER_ENABLED: "true"` | Default stays on until Step 5. |

## How to re-run the inventory locally

```bash
# Backend callers / mounts (returns ~12 matches in repo today, including docs).
rg -n "api/selenium|browserAutomationService" --hidden -g '!node_modules' -g '!**/.next/**' -g '!**/dist/**'

# Frontend call sites only (should be 1 file today).
rg -n "/api/selenium" apps/web/src

# Direct dependency on `playwright` in api-express (no `puppeteer` in that app).
rg -n '"playwright"' apps/api-express/package.json

# All references to the legacy env flag (helps when flipping default).
rg -n "LEGACY_PUPPETEER_ENABLED"
```

The list above must be ≤ 0 (frontend) and the legacy `/api/selenium` implementation removed from `api-express` before Step 6 runs.

---

## Step 1 — Route every prod flow through `POST /api/v1/scrape-jobs`

**Goal:** the only writer of real scrape work is the BullMQ master queue.

- [ ] Add a worker-side handler for **`khanan_date_range`** that fully replaces `browserAutomationService.scheduledScrapingTask` (persist daily rows to `processed.*`, emit `ingest.job_events` rows for SSE).
- [ ] Define / extend `processed.*` models in `packages/db/prisma/schema.prisma` for the scraped Khanan rows; run `pnpm --filter @vahan360/db db:migrate:deploy`.
- [ ] Add a contract for **`khanan_daily`** (yesterday-only) if the operator UX needs the equivalent of `GET /api/selenium/dailyScraping`. Reuse `khanan_date_range` with `fromDate == toDate` otherwise.
- [ ] Verify SSE (`GET /api/v1/scrape-jobs/:id/stream`) carries the same operator-visible progress signals that the old `/api/selenium/status` poll used to surface.

**Exit:** dev `curl` against `POST /api/v1/scrape-jobs` produces the same Postgres rows that the legacy in-API Playwright run would have produced.

---

## Step 2 — Cut the frontend over (single page)

**Goal:** drop the only remaining caller of `/api/selenium/*` in the SPA.

- [ ] In `apps/web/src/app/dashboard/khanansoft/page.tsx`, replace direct fetches with the async pattern:
  1. `POST /api/v1/scrape-jobs` with `{ kind: 'khanan_date_range', correlationId, fromDate, toDate }` (+ optional `Idempotency-Key`).
  2. Read `jobId` from the response; subscribe to `GET /api/v1/scrape-jobs/:id/stream` (SSE) for progress, or poll `GET /api/v1/scrape-jobs/:id/events`.
  3. Surface the new "queued / running / completed / failed" lifecycle in the UI (replace "scraper already running" polling logic with the per-job status).
- [ ] Remove any local state that depended on the singleton scraper (`isProcessing`, `lastRun`) — those concepts no longer apply per-process.
- [ ] **Don't** delete the page; just swap the API contract.
- [ ] Re-run the frontend grep — `rg -n "/api/selenium" apps/web/src` must return 0 matches.

**Exit:** SPA functions end-to-end against a worker-only backend (`LEGACY_PUPPETEER_ENABLED=false` locally).

---

## Step 3 — Flip the default to off everywhere

**Goal:** in-API legacy browser automation never runs in prod; legacy routes return 410.

- [ ] `apps/api-express/.env.example` → set `LEGACY_PUPPETEER_ENABLED=false` (or remove the var) and update the README env table.
- [ ] `deploy/helm/vahan360/values.yaml` → flip `config.LEGACY_PUPPETEER_ENABLED: "false"`.
- [ ] `docker-compose.yml` → make sure the local `api-express` env block matches.
- [ ] Add a CI smoke step: hit `GET /api/selenium/by-date-range` against a running test container and assert **HTTP 410** + the `migration` hint body.

**Exit:** legacy routes are off by default; ops can still re-enable temporarily by setting the flag back to `true` if rollback is needed.

---

## Step 4 — Soak in production

**Goal:** make sure no surprise caller exists outside the repo (mobile, ops scripts, partners).

- [ ] Leave the flag off for **≥ 1 full release cycle** (or whatever your SLO playbook requires).
- [ ] Add a Prometheus counter `legacy_puppeteer_blocked_total` incremented on the 410 path — alert on `> 0` for `1h`.
- [ ] Track DLQ depth + scrape-job throughput dashboards: confirm the new queue replaces the old throughput cleanly.

**Exit:** zero blocked legacy traffic across the soak window; on-call sign-off.

---

## Step 5 — Code & dependency removal

**Goal:** drop the in-api Playwright/Chromium footprint once nothing calls `/api/selenium/*`.

- [ ] Remove `app.use("/api/selenium", …)` mount in `apps/api-express/src/app.js` and delete `apps/api-express/src/routes/legacyBrowserAutomation.js`.
- [ ] Delete `apps/api-express/src/services/browserAutomationService.js`.
- [ ] Delete `apps/api-express/src/utils/scrapeRangeValidation.js` only if not reused by `scrapeJobs.js` (re-grep `scrapeRangeValidation` first).
- [ ] Remove `"playwright"` from `apps/api-express/package.json` if nothing else needs it; run `pnpm install` to update the lockfile.
- [ ] Drop the `LEGACY_PUPPETEER_ENABLED` env from:
  - `apps/api-express/.env.example`
  - `deploy/helm/vahan360/values.yaml`
  - `README.md` env table.
- [ ] Trim `apps/api-express/Dockerfile` if it still installs Chromium system deps that only Puppeteer needed (Playwright handled separately in the worker image; check before deleting).
- [ ] Update `docs/MIGRATION_AND_CLEANUP.md` Phase A — tick the remaining boxes; reflect the removal in `ARCHITECTURE.md`.

**Exit:** `pnpm install` does not download Chromium for `api-express`; CI build size shrinks; grep below returns **0** matches outside docs.

```bash
rg -n "puppeteer|browserAutomationService|api/selenium|LEGACY_PUPPETEER_ENABLED" \
  --hidden -g '!node_modules' -g '!pnpm-lock.yaml' -g '!docs/**' -g '!**/.next/**' -g '!**/dist/**'
```

---

## Step 6 — Lock the door

**Goal:** make regressions loud.

- [ ] Add a CI guard step:
  ```bash
  if rg -n "puppeteer|api/selenium" apps packages \
     -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/.next/**'; then
    echo "::error::Puppeteer/legacy /api/selenium re-introduced"; exit 1
  fi
  ```
- [ ] Add a comment header to `apps/api-express/src/routes/scrapeJobs.js`: "This is the only supported scrape ingest entry point — see `docs/PUPPETEER_SUNSET_PLAN.md`."
- [ ] Close the corresponding Phase A items in `docs/MIGRATION_AND_CLEANUP.md`.

---

## Rollback strategy

Each step is reversible until **Step 5** runs:

- Steps 1–4: flip `LEGACY_PUPPETEER_ENABLED=true` in env/Helm to restore the legacy route. Frontend keeps working because the migration in Step 2 doesn't delete the page — only its fetch logic. Revert that file from Git to restore the old call pattern.
- Step 5+: rollback requires Git revert of the deletion PR and `pnpm install` to restore the prior `playwright`/route layout.

## Hinglish quick note

- **Aaj:** ek Next page (`khanansoft`) abhi bhi `/api/selenium/*` ko call karta hai; Express in-process scraper ab **Playwright** (`playwright` package) use karta hai.
- **Plan:** Step 1 worker handler real karo → Step 2 SPA ko `/api/v1/scrape-jobs` par switch → Step 3 default off → Step 4 soak + alert → Step 5 code + dep delete → Step 6 CI guard.
- **Ab:** Express legacy path **Playwright** par hai; `puppeteer` dependency hata di gayi. Baaki steps (frontend → queue, default 410, CI guard) ab bhi apply hote hain.
