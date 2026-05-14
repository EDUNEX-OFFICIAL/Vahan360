# Vahan360 — enterprise spec progress (% report)

**Last updated:** 2026-05-13 (Khanan async feature flag + legacy 410 metric).

> **Docs-only snapshot.** Percentages are **estimates** aligned to `docs/ENTERPRISE_COMPLETION_CHECKLIST.md` plus quick repo greps (read-only). Not a financial or contractual commitment — **engineering judgment** for prioritization.

---

## 1) Method (how this report was produced)

1. **Primary source:** Read `docs/ENTERPRISE_COMPLETION_CHECKLIST.md` end-to-end (sections **1–15**, legend ✅ / 🟡 / ❌, “Honest summary”).
2. **Quick greps** (readonly `rg`-style search under `Vahan360/`) for cross-checking claims and implementation hints:
   - **`spybot_token`** — still present in `apps/web` (`src/lib/api-client.ts`, `login/page.tsx`, multiple dashboard pages) and referenced in security docs.
   - **`localStorage`** — JWT storage path + other pages (e.g. `khanansoft`) using `localStorage` for non-auth caches.
   - **`api/selenium`** — `khanansoft` uses legacy mount when **`NEXT_PUBLIC_KHANAN_USE_ASYNC_JOBS`** is unset/false; `true`/`1` switches to **`/api/v1/scrape-jobs`**; docs + scripts also mention legacy routes.
   - **`playwright` / `playwright-core`** — `browserAutomationService.js` (legacy in-API path), worker optional smoke (`@vahan360/scraper-core`), `packages/browser-pool`, CI optional smoke lane.
   - **`bullmq`** — `apps/api-express` queue enqueue, `apps/worker-ingest` workers, Bull Board adapters.
   - **`OpenTelemetry` / `@opentelemetry`** — `apps/api-express/src/telemetry.js`, `apps/worker-ingest/src/telemetry.js`, propagation in `ingestQueue.js` / `runWithJobTraceContext.js`; checklist still marks **Nest OTLP** as not wired in `main.ts`.
   - **`helm`** — `deploy/helm/vahan360`, CI `helm lint` / `helm template`.
   - **`nestjs` / `@nestjs`** — `apps/api-nest` controllers/modules; no `@UseGuards` per checklist.
   - **`prisma`** — `packages/db/prisma/schema.prisma` (`ingest`, `processed`, `system` models + migrations); `apps/api-express/prisma` for `public` app schema.

**Note:** `packages/db` ab **`processed`** ke andar stub aggregate models (`ProcessedVehicleTripSummary`, compliance, consigner, district) dikhate hain — lekin checklist §6/§7 ke hisaab se **Nest APIs ab bhi stub JSON** return karti hain; isliye “DB modeled” vs “product wired” ko alag rakha gaya hai.

---

## 2) Table — checklist blocks **1–15**

| # | Spec block (checklist title) | Est. % (0–100) | One-line justification |
|---|------------------------------|----------------|-------------------------|
| 1 | Monorepo, build system & developer experience | **78** | pnpm/Turbo/apps/packages ship; **lint coverage gaps** (api-nest/web), **no Husky**, api-express JS vs strict TS baseline incomplete. |
| 2 | Authentication & session security | **42** | Express JWT + Helmet + CORS solid; **httpOnly/refresh/CSRF missing**, **JWT still in `localStorage`**, **Nest guards absent**, open **register-user** risk. |
| 3 | Authorization (RBAC, multi-tenancy) | **28** | `roles` column exists but **no route-level enforcement**; Nest RBAC **placeholder**; **no tenant scoping / audit_events table** per checklist. |
| 4 | Async ingest pipeline (BullMQ + DLQ + retry) | **82** | Master/child/DLQ/retry/metrics/idempotency/backoff **shipped**; **KEDA/queue HPA** missing; **alerting** rules exist but end-to-end ops wiring partial. |
| 5 | Legacy Puppeteer / `/api/selenium` removal | **70** | **Playwright** legacy mount + **410 gate** + **`legacy_puppeteer_blocked_total`** (metrics on); **Khanan** page **feature-flagged** (`NEXT_PUBLIC_KHANAN_USE_ASYNC_JOBS`, default off → legacy); **Helm default legacy-on**; worker kinds partly stub. |
| 6 | Vehicle intelligence engine (Prisma-backed reads) | **25** | Routes/controllers **mounted** but **real reads + risk engine + caching** not implemented (`not_implemented`-style gap per checklist). |
| 7 | Domain analytics surfaces | **38** | **Next pages exist** + Nest controllers **shaped**; **no real aggregates**, charts, or exports per checklist. |
| 8 | Browser pool & distributed browser-manager | **32** | **In-process pool skeleton** + env knobs; Helm **browser-manager** is **placeholder** HTTP; **no real RPC browser-manager / per-tenant quotas**. |
| 9 | Database layer (Prisma, partitioning, replicas) | **64** | **Multi-schema Prisma**, indexes, queue metrics, health path **good**; **`processed` stubs exist** in `packages/db` but **not** full intelligence domain per §6; **partitioning + read replicas + PgBouncer in cluster** absent. |
| 10 | Observability (metrics, traces, logs, alerting) | **72** | Prometheus workers/API, structured logs, **OTEL on Express + worker**, trace context over BullMQ **yes**; **Nest OTLP**, **HTTP histogram gaps**, **Alertmanager/on-call** missing. |
| 11 | Deployment (Helm, ArgoCD, Docker, CI) | **78** | Chart + Dockerfiles + **CI build/validate/helm** strong; **image push/signing/SBOM/multi-arch** not done; browser-manager placeholder drags “complete deploy story”. |
| 12 | Security hardening (CORS, rate limits, secrets, regex) | **60** | Helmet, scrape/global rate limits, trust proxy, JWT secret enforcement **good**; **Vault/SealedSecrets**, **Nest unguarded surface**, **regex audit**, **register-user** lockdown **open**. |
| 13 | API contracts (Express v1, Nest v2) | **72** | **docs/API_CONTRACTS.md**, proxy, Nest Swagger **done**; **Express OpenAPI generator**, **runtime contract tests** thin/partial. |
| 14 | Frontend modernization (auth, perf, large pages) | **45** | Next 16 + ESLint baseline **ok**; **`spybot_token` / localStorage JWT** unresolved; **large pages / shell search / typo route** debt remains. |
| 15 | Operations & runbooks | **52** | DLQ/retry/scaling/migration **docs strong**; **backup/restore, incident playbooks, DR targets, Alertmanager routing** largely absent. |

---

## 3) Weighted overall %

**Proposed weights** (must sum to **100%** — emphasis on **ship path**: ingest + deploy + security + data product):

| Theme | Sections included | Weight \(w_i\) % |
|-------|--------------------|------------------|
| Platform & DX | §1 | **4** |
| Auth & session | §2 | **12** |
| RBAC / tenancy | §3 | **7** |
| Ingest & scale | §4 | **16** |
| Legacy sunset | §5 | **5** |
| Vehicle intelligence | §6 | **9** |
| Domain analytics | §7 | **9** |
| Browser / automation infra | §8 | **5** |
| Data / Prisma / DB ops | §9 | **9** |
| Observability | §10 | **6** |
| Deploy & CI | §11 | **6** |
| Security hardening (surface + secrets) | §12 | **5** |
| API contracts | §13 | **4** |
| Frontend | §14 | **4** |
| Ops runbooks | §15 | **3** |
| **Total** | | **100** |

**Formula (explicit):**

Let \(p_i\) = estimated completion % for checklist block \(i\) (table above), and \(w_i\) = non-negative weight with \(\sum_{i=1}^{15} w_i = 100\).

\[
\textbf{Overall \%} = \frac{1}{100} \sum_{i=1}^{15} w_i \cdot p_i
\]

**Numeric substitution:**

\[
\begin{aligned}
\text{Sum} &= 4\cdot78 + 12\cdot42 + 7\cdot28 + 16\cdot82 + 5\cdot70 + 9\cdot25 + 9\cdot38 + 5\cdot32 + 9\cdot64 + 6\cdot72 + 6\cdot78 + 5\cdot60 + 4\cdot72 + 4\cdot45 + 3\cdot52 \\
&= 5801
\end{aligned}
\]

\[
\textbf{Overall \%} = \frac{5801}{100} = \textbf{58.01\%} \approx \textbf{58\%}
\]

---

## 4) Delta note (vs informal ~48% / ~22–28% narratives)

Pehle jo informal **~48% “whole product”** ya **~22–28% “security + intel surface”** wali baatein hoti thi, unka checklist-based weighted score (**~58%**) thoda **zyada** nikalta hai — **reason:** is formula mein **§4 ingest**, **§10 observability**, **§11 Helm/CI** ko **bhaari weights** mile hain, aur yeh blocks checklist ke mutabiq **mostly green** hain.

**Playwright swap** (§5) se **Puppeteer-era risk kam** hua, lekin **“enterprise done”** tabhi maani jayegi jab **`/api/selenium` caller zero**, **default legacy-off**, aur **in-api Playwright footprint** sunset ho — isliye §5 ko 100% nahin diya.

Agar weights ko **zyada product/security-heavy** (§2, §6, §7, §14) kar do, overall **phir ~45–52%** ke paas aa sakta hai — yeh hi **~48%** narrative se reconcile karta hai. **Same repo, different “what matters” weighting.”**

---

## 5) Next five **P0** tasks (from largest checklist gaps)

1. **Cookie-based session + refresh rotation + CSRF** — `docs/SECURITY_ROADMAP_HTTPONLY.md` phases; blocks §2, §14, parts of §12.
2. **Nest `/api/v2` auth verification (`AuthGuard` / shared JWT validation)** — proxy ab header forward karta hai bina Nest-side verify ke (§2, §12).
3. **`khanansoft`**: flip default to async (`NEXT_PUBLIC_KHANAN_USE_ASYNC_JOBS` **on** in prod) + optional SSE parity check; phir **`LEGACY_PUPPETEER_ENABLED` default false** + eventual route deletion (§5).
4. **`processed.*` / ingest reads wired into Nest** (vehicle + domain modules) so dashboards exit stub land (§6, §7, §9 alignment).
5. **`register-user` lockdown** + Express **role middleware** on admin/scrape paths + **RBAC** decorator/guard path on Nest (§2, §3, §12).

---

## File location

Report path: **`docs/PROGRESS_PERCENT_REPORT.md`** (this file).
