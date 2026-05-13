# MongoDB → PostgreSQL migration plan (Vahan360 / Spybot)

This document is a **step-by-step runbook** for migrating the Express + Mongoose backend from MongoDB to PostgreSQL. It is grounded in the current codebase and aligns with the database findings in [VAHAN360_TECHNICAL_AUDIT.md](./VAHAN360_TECHNICAL_AUDIT.md) (Section 7).

**Scope of this file:** guidance and checklists only. It does not modify application code by itself.

---

## Source → target (DigitalOcean Mongo → PostgreSQL)

**Current state:** **Operational scrape data** lives in **MongoDB on DigitalOcean** — database **`khanan_db`**. Raw rows may appear as **`khanan_data`** and/or **`khanandatas`** (Java Spring vs Node/Mongoose naming); Compass shows **`khanan_data` ~25M** docs. Other collections: **`vehicletripsummaries`**, **`users`**, etc. Node writes via [`browserAutomationService.js`](../apps/api-express/src/services/browserAutomationService.js) (Playwright; legacy HTTP mount **`/api/selenium`** is URL-only naming); aggregation in [`vehicleAggregator.js`](../apps/api-express/src/utils/vehicleAggregator.js).

**Target state:** PostgreSQL deployed on your **Hostinger VPS** (self-hosted), matching [docs/schema/postgres/README.md](./schema/postgres/README.md). Data flows **DigitalOcean Mongo → (network) → Postgres on VPS**; the app then uses `DATABASE_URL` per Section 8.

**Local laptop — two different things:**

- **New scrape → Postgres locally (dev):** Start the **pipeline** on your machine: local Postgres (e.g. Docker), `DATABASE_URL` → localhost, run apps/api-express/scraper so **fresh scrape rows** begin landing in Postgres. Then **deploy the same** (compose / env / migrations) to **Hostinger VPS** and point live `DATABASE_URL` at VPS Postgres — **fast path to production** for *going forward*.
- **Historical ~25M rows backfill:** **Do not** copy the full production Mongo export onto a laptop. Use **VPS-side (or server) chunked ETL** into Postgres on the VPS.

---

## Local-first scrape → quick VPS deploy

**Intent:** Pehle **scrape data locally Postgres mein aana start** ho (development); phir **turant** wahi setup **live VPS** par deploy — same schema, same env pattern.

| Step | Local (dev) | VPS (live) |
|------|-------------|------------|
| 1 | Postgres: Docker Compose `postgres` image ya local install; apply schema from [schema/postgres](./schema/postgres/README.md). | Postgres install + create DB + same migrations / SQL DDL. |
| 2 | `DATABASE_URL=postgresql://user:pass@localhost:5432/khanan` (example). | `DATABASE_URL` → VPS `localhost` or private socket; secrets via env / vault. |
| 3 | Run API + scraper against Postgres once code writes to PG (Section 8). **Volume = only new scrapes** during dev — disk manageable. | Deploy same containers/processes; ensure Mongo IP allowlist includes **VPS IP** if scraper still reads Mongo during transition. |
| 4 | Smoke test: insert/query `khanan_data`, auth `users`. | Point DNS / nginx to VPS; monitor disk & connections. |

**Note:** Poorana **25M** historical load **alag kaam** hai — VPS par batch ETL (section below). Local-first workflow **cutover / new writes** ke liye hai; dono parallel plan kar sakte ho.

---

**Inventory** ([schema docs](./schema/postgres/README.md)):

| Mongo collection | Scale / notes | Postgres table doc |
|------------------|---------------|---------------------|
| **`khanan_data`** | Compass shows **~25M documents** on prod cluster (sample doc includes `_class` → legacy **Spring/Java** writer alongside Node/Mongoose). | [khanan_data.md](./schema/postgres/khanan_data.md) |
| **`khanandatas`** | Mongoose default collection name — **also listed** in Compass beside `khanan_data`. Run **`countDocuments()` on both**; migrate whichever holds production rows (or both if split-era data). | same target table conceptually |
| `vehicletripsummaries` | Count on prod cluster | [vehicle_trip_summary.md](./schema/postgres/vehicle_trip_summary.md) |
| `users` | Count on prod cluster | [users.md](./schema/postgres/users.md) |

**Optional checks before ETL** (complete when you finalize infra — no blocker for schema design):

1. Confirm **no other Mongo databases/collections** hold production scrape data besides `khanan_db` (`show dbs` + counts).
2. **Hostinger VPS:** size disk (**100 GB+** realistic for 25M rows + indexes), RAM for Postgres; **allow outbound TLS** to DigitalOcean Mongo (firewall); **Mongo Atlas-style IP allowlist**: add **VPS public IP** so cluster accepts connections from the migration worker / API.
3. Plan **last full backup** of Mongo (`mongodump` to **server storage** or object storage — not full restore on laptop).
4. Decide **cutover style**: maintenance window vs dual-write vs stop-scrape-then-migrate (Section 11).

---

## Next phase: production-scale move (**~25M** raw Khanan rows)

**DigitalOcean Mongo → PostgreSQL on Hostinger VPS** — **no full local copy** on your development machine; use **server-side or streaming ETL**.

### Step 1 — Confirm numbers (same cluster)

Prod Mongo par run (**both** collection names if Compass shows two):

```javascript
use khanan_db
db.khanan_data.countDocuments()
db.khanandatas.countDocuments()
db.vehicletripsummaries.estimatedDocumentCount()
db.users.estimatedDocumentCount()
```

Compass already shows **`khanan_data` ≈ 25M** — align `mongosh` counts with that cluster.

### Step 2 — Postgres sizing (Hostinger VPS)

Rough ballpark: **25M × ~0.5–1 KB/doc ≈ tens of GB** data; indexes **extra**. Plan:

- **Disk:** **100 GB+** VPS disk (or separate volume) for Postgres data directory + WAL + room for index builds.
- **RAM:** **≥ 4–8 GB** VPS practical minimum for this volume; more helps `CREATE INDEX CONCURRENTLY` and autovacuum.
- **Where ETL runs:** prefer **on the VPS** (Node/Python container) writing to **local Postgres** over `localhost`, pulling from Mongo over TLS — avoids filling your laptop disk with dumps.

### Step 3 — ETL approach (recommended pattern)

1. **Create Postgres schema** — tables + **PK**; **defer heavy secondary indexes** on `khanan_data` until after bulk load (keep **`UNIQUE (challan_no)`** strategy clear — either load then add unique, or use staging + dedupe SQL).
2. **Stream / batch from Mongo** — **never** hold 25M docs in memory:
   - Cursor-based export: `_id` ranges or **time buckets** (`createdAt` batches), **50k–250k rows** per batch.
   - Transform camelCase → snake_case per batch → **`COPY`** / batched `INSERT` into Postgres on **VPS** (transactions per batch).
3. **Tools:** custom **Node** script (`mongodb` driver cursor + `pg` COPY) is typical; alternatives evaluated per team (Airbyte / custom); validate **SSL** to DigitalOcean Mongo and **private/local** Postgres on VPS.
4. **`vehicle_trip_summary`:** optional — **rebuild from Postgres `khanan_data`** using SQL `GROUP BY` vehicle (same logic as [`vehicleAggregator.js`](../apps/api-express/src/utils/vehicleAggregator.js)) instead of copying Mongo collection, if business agrees totals match.
5. **`users`:** small — migrate anytime; often **first**.

### Step 4 — Validation

- Row **count** match Mongo vs PG for `khanan_data`.
- Random **`challan_no`** spot checks; optional checksum / count by **district+month** bucket.

### Step 5 — Cutover

- **Freeze** scraper or **dual-write** briefly if you implement it (complex); simpler: **maintenance window** → final incremental delta from Mongo → flip **`DATABASE_URL`** → deploy Postgres-backed API (Section 8).

### Step 6 — App / ops

- Connection **pool** limits (`pg` pool size) vs Postgres `max_connections`.
- **Long date-range API queries** — audit wala `$in` date list Postgres par bhi heavy ho sakta hai; medium-term **normalize `date` to real `date` type** (Section 8).

---

## 1. Why migrate (short)

PostgreSQL gives **strong schemas**, **relational constraints**, **mature SQL tooling**, and often simpler ops for reporting-style workloads. This project already uses **fixed Mongoose schemas** and **indexed lookups** — a good fit for Postgres tables + indexes.

---

## 2. Current MongoDB usage (evidence map)

| Collection (Mongoose model) | Source file | Role |
|-----------------------------|-------------|------|
| `KhananData` | `apps/api-express/src/models/KhananData.js` | Raw scraped mineral / challan rows |
| `VehicleTripSummary` | `apps/api-express/src/models/VehicleTripSummary.js` | Denormalized CRM-style summary per vehicle |
| `User` | `apps/api-express/src/models/User.js` | Auth (`username`, `password`, `tokenVersion`, etc.) |

**Connection:** `apps/api-express/src/app.js` — `MONGODB_URI`, `MONGODB_DB_NAME`.

**Heavy usage:**

- **Reads/filters:** `apps/api-express/src/routes/khanan.js` — date filter uses **`$in`** with a **list of formatted date strings** (audit: large ranges → BSON/query size risk).
- **Aggregations:** `apps/api-express/src/utils/vehicleAggregator.js` — Mongo **`$group`**, **`$convert`** on quantity; `khanan.js` stats route — **`$match` + `$group`**.
- **Regex search:** `apps/api-express/src/utils/vehicleQueryBuilder.js` — Mongo **`RegExp`** on many fields (audit: ReDoS risk if user input not escaped consistently).
- **Writes:** `apps/api-express/src/services/browserAutomationService.js` — **`insertMany`** with **`ordered: false`**; duplicate key **`11000`** handling for challan dedupe.
- **Upserts:** `apps/api-express/src/routes/vehicle.js`, `vehicleAggregator.js` — **`findOneAndUpdate`** with **`upsert: true`**.

---

## 3. Prerequisites

- Access to **source MongoDB** — here **DigitalOcean Managed MongoDB** (`khanan_db`): read-only export / `mongodump` before destructive steps.
- **PostgreSQL** 15+ (or 16) — **new** database you will create; rehearsal on staging strongly recommended.
- Decide **ORM / query layer**: Prisma, Drizzle, Knex, or `pg` + handwritten SQL. (Pick one team-wide.)
- Backup strategy: **Mongo** snapshot/dump + **Postgres** dump after successful load; keep until rollback window closes.

---

## 4. Schema discovery (Compass + mongosh)

**Workflow:** Pehle Mongo par **collections, indexes, counts, sample documents** confirm karo (Compass visual + mongosh reproducible output), phir [Section 5](#5-postgresql-schema-design-logical) ke Postgres tables map karo.

### Compass

- `khanan_db` expand karo → collection names note karo.
- Har collection: **Documents** (1–2 samples for field names/types) + **Indexes** tab (Postgres index parity).

### mongosh — connect

DigitalOcean panel se **full connection string** copy karo; `<replace-with-your-password>` ki jagah **database user (`doadmin`) ka password** lagao (DO account login password **nahi**). TLS params string mein rehne do.

```bash
mongosh "mongodb+srv://doadmin:YOUR_DB_PASSWORD@db-mongodb-blr1-34966-69567f90.mongo.ondigitalocean.com/admin?tls=true&authSource=admin&replicaSet=db-mongodb-blr1-34966"
```

(`YOUR_DB_PASSWORD` ko PowerShell mein carefully escape karna pad sakta hai agar special chars hon — Compass se connect ho to **Open MongoDB Shell** bhi use kar sakte ho, wahan password prompt avoid ho sakta hai.)

### mongosh — commands (run karke output share kar sakte ho)

```javascript
show dbs
use khanan_db
show collections
```

Collection names Mongoose pluralization ke hisaab se honge (commonly `khanandatas`, `vehicletripsummaries`, `users`) — `show collections` se exact naam lo, phir har ek ke liye:

```javascript
// Count (bara data ho to pehle estimated — fast)
db.khanandatas.estimatedDocumentCount()
db.khanandatas.countDocuments()

// Sample document — fields / nested structure
db.khanandatas.findOne()

// Indexes — Postgres CREATE INDEX planning ke liye
db.khanandatas.getIndexes()

// Optional: rough storage
db.khanandatas.stats()
```

Baaki collections ke naam se repeat:

```javascript
db.users.estimatedDocumentCount()
db.users.getIndexes()
db.users.findOne()

db.vehicletripsummaries.estimatedDocumentCount()
db.vehicletripsummaries.getIndexes()
db.vehicletripsummaries.findOne()
```

### Report karte waqt (safe sharing)

- Collection names + **counts**
- `getIndexes()` output (keys / partial filters)
- `findOne()` se **field list** — agar `password` hash dikhe to value **redact** karke paste karna

---

## 5. PostgreSQL schema design (logical)

Use **snake_case** columns in Postgres; map from camelCase in JS.

**Per-table specs (columns, indexes, Mongo mapping) live in separate files — update those as you discover more from Compass / `mongosh`:**

| Table | Documentation |
|--------|----------------|
| `users` | [docs/schema/postgres/users.md](./schema/postgres/users.md) |
| `khanan_data` | [docs/schema/postgres/khanan_data.md](./schema/postgres/khanan_data.md) |
| `vehicle_trip_summary` | [docs/schema/postgres/vehicle_trip_summary.md](./schema/postgres/vehicle_trip_summary.md) |

Index: [docs/schema/postgres/README.md](./schema/postgres/README.md)

---

## 6. Data export from MongoDB

1. **Inventory counts:** `db.khanandatas.countDocuments()`, `vehicle_tripsummaries`, `users` — collection names may be Mongoose-pluralized (`khanandatas`, etc.); verify in Mongo shell or Compass.
2. **Export options:**
   - **`mongoexport`** / **`mongodump`** per collection → JSON/BSON; or
   - Small **Node script** (existing Mongoose models) streaming to NDJSON for controlled transforms.
3. **Preserve:** `_id` as `legacy_mongo_id` if you need row-level audit during validation.

---

## 7. Transform & load (ETL)

1. **Normalize:** camelCase → snake_case; trim strings; map invalid dates to NULL where types change.
2. **Order:** load **`users`** first, then **`khanan_data`**, then **`vehicle_trip_summary`** (no FK required between khanan and summary today; order is for sanity / scripts).
3. **Dedupe:** enforce **`UNIQUE (challan_no)`** — conflicts should match current “duplicate challan” behavior (`11000` in Puppeteer path).
4. **Bulk load:** use **`COPY ... FROM`** for large `khanan_data`; wrap in transactions per batch.
5. **Validate:** row counts vs Mongo; spot-check random `challan_no` / `vehicle_reg_no`; compare **`aggregateVehicles`**-style totals in SQL vs Mongo aggregation on a sample date range.

---

## 8. Application rewrite checklist (future implementation)

Do **not** treat this as mandatory order for coding — it’s a dependency-aware checklist.

1. **`apps/api-express/src/app.js`**  
   - Remove `mongoose.connect`; add Postgres pool (`pg` or ORM client).  
   - Health check endpoint should verify DB connectivity.

2. **Auth** — `apps/api-express/src/routes/auth.js`, `apps/api-express/src/middleware/auth.js`  
   - Replace `User.findOne`, `save`, `tokenVersion` updates with SQL/ORM equivalents.

3. **Khanan API** — `apps/api-express/src/routes/khanan.js`  
   - Replace `find`, `countDocuments`, `aggregate`, `distinct` with SQL (`WHERE`, `GROUP BY`, `COUNT`, `SELECT DISTINCT`).  
   - **Date filter:** either keep generating a list of formatted strings and use `WHERE date = ANY($1::text[])` **or** change storage to real dates and use range queries (recommended long-term).

4. **Vehicle API** — `apps/api-express/src/routes/vehicle.js`  
   - Replace `find`, `findOne`, `findOneAndUpdate`, `aggregate`, `distinct`.  
   - **Upsert:** `INSERT ... ON CONFLICT (vehicle_reg_no) DO UPDATE`.

5. **Query builder** — `apps/api-express/src/utils/vehicleQueryBuilder.js`  
   - Today returns Mongo filter objects with **`RegExp`**. In Postgres use parameterized **`ILIKE`**, **`SIMILAR TO`**, or **`pg_trgm`** for search — **always escape** user input (audit concern).

6. **Aggregator** — `apps/api-express/src/utils/vehicleAggregator.js`  
   - Replace `KhananData.aggregate([...])` with one SQL query: `GROUP BY` normalized `vehicle_reg_no`, `SUM`, `MAX`/`MIN` as needed; then upsert into `vehicle_trip_summary`. Consider reducing **per-row** round trips (audit noted **O(n) `findOneAndUpdate`**).

7. **Scraper** — `apps/api-express/src/services/browserAutomationService.js`  
   - Replace `insertMany` with batched **`INSERT ... ON CONFLICT DO NOTHING`** on `challan_no` (or equivalent) and map Postgres **unique_violation** (`23505`) instead of Mongo `11000`.

8. **Scripts** — `apps/api-express/scripts/sync-local-user.js`  
   - Point to Postgres or replace with SQL seed.

9. **Dependencies** — `apps/api-express/package.json`  
   - Remove `mongoose`; add `pg` or chosen ORM + migration CLI.

10. **Docker / env** — `docker-compose.yml`, README  
   - Add `postgres` service + `DATABASE_URL`; retire `MONGODB_URI` when cut over.

---

## 9. Testing strategy

- **Unit:** query-builder tests (`apps/api-express/src/utils/__tests__/vehicleQueryBuilder.test.js`) → rewrite expectations for SQL adapter / predicates.
- **Integration:** login, `/api/khanan/data`, `/api/vehicle/trip-summary`, `POST /api/vehicle/sync` (or equivalent) against Postgres in CI or docker-compose.
- **Performance:** compare heavy filters and aggregation runtime; add indexes only after measuring.

---

## 10. API / JWT contract

Today login likely exposes Mongo **`_id`**. Decide explicitly:

- **Option A:** JWT payload uses new **`uuid` / bigint** string — **@vahan360/web** (`apps/web/src/app/login/page.tsx`, etc.) must still work with stored user id if used.
- **Option B:** keep a stable **`legacy_mongo_id`** column only for audit, but issue new ids to clients.

Document the chosen option in README / API notes.

### Khanan scrape: date range, env, and duplicates

- **`SCRAPE_MAX_RANGE_DAYS`** (default **31**): maximum inclusive calendar span for **`POST /api/selenium/scrape-range`** and for validated **`GET /api/selenium/by-date-range`** (paths under **`LEGACY_ROUTE_MOUNT=/api/selenium`** — legacy URL prefix; routes: `apps/api-express/src/routes/legacyBrowserAutomation.js`).
- **`SCRAPE_ALLOW_FUTURE_DATES`**: set to **`1`** or **`true`** to allow `fromDate` / `toDate` in the future; default behaviour rejects future dates.
- **`SCRAPE_AUTO_SYNC_VEHICLES`**: set to **`1`** / **`true`** to auto-run vehicle summary aggregation after scraper completion (same effect as `POST /api/vehicle/sync`), so Leads can pick up latest Khanan rows without manual sync.
- **Redundant scrape guard:** date-range and quick daily start endpoints perform a preflight DB coverage check and skip starting scraper if selected scope already has data.
- **Last-run persistence:** latest run metadata is persisted in scraper state storage and returned via **`/api/selenium/status`** and **`/api/selenium/last-run`** (same legacy mount), surviving backend restarts.
- **Duplicates:** Postgres keeps **`challan_no` unique**; the scraper uses **`createMany({ skipDuplicates: true })`**. Re-scraping the same calendar day does **not** insert duplicate challan rows—only **new** challan numbers from the portal are inserted; everything else is skipped.
- **`SCRAPING_MODE=local`:** date-range runs use **`runLocalScraping`** (seeded rows), not the live Khanan portal.

---

## 11. Cutover procedure (production-minded)

1. **Freeze** writes or enable **read-only** on app briefly if possible.
2. **Final delta:** re-export Mongo changes since last bulk load (or short maintenance window).
3. **Switch** env to Postgres; restart API.
4. **Smoke test:** login, khanan list, vehicle summary, scrape trigger (staging first).
5. **Rollback plan:** keep Mongo read-only snapshot + ability to flip env back until stable.

---

## 12. Post-migration cleanup

- Drop Mongo credentials from secrets manager / `.env`.
- Remove mongoose from lockfiles after code migration.
- Optional: archive last Mongo backup per retention policy.

---

## 13. Production security hardening (JWT + Postgres auth)

### JWT_SECRET rotation

- **`NODE_ENV=production`** par backend tab tak start nahi karega jab tak **`JWT_SECRET`** set na ho aur **kam se kam 32 characters** ka na ho (placeholder values reject).
- **Rotate:** naya secret generate karo (`openssl rand -base64 48` ya `pnpm --filter @vahan360/api-express run jwt:secret` — output [`apps/api-express/scripts/generate-jwt-secret.js`](../apps/api-express/scripts/generate-jwt-secret.js)), secrets manager / `.env` update, API redeploy. **Saare purane JWT invalid** — users dubara **login** karenge.
- Docker Compose: `JWT_SECRET` ko compose ke saath wali **`.env`** mein set karo (commit mat karo).

### Postgres: SCRAM-only, `trust` nahi

- **`trust`** authentication production / VPS par publicly reachable Postgres ke liye **kabhi mat chhoro** — migration ke dauran jo temporary `pg_hba` edits hue hon, cutover se pehle hata do.
- Official Docker **`postgres`** image host TCP par **password / SCRAM** use karti hai; compose mein `POSTGRES_HOST_AUTH_METHOD=scram-sha-256` **nayi** data directory init par align rehta hai (purana volume = manual `pg_hba` review ya controlled reset).
- Strong **`POSTGRES_PASSWORD`** + firewall (sirf app host / private network) best practice.

---

## 14. Reference diagram

```mermaid
flowchart LR
  subgraph before [Before]
    Express1[Express]
    Mongoose[Mongoose]
    Mongo[(MongoDB)]
    Express1 --> Mongoose --> Mongo
  end
  subgraph after [After]
    Express2[Express]
    Pool[pg_or_ORM]
    PG[(PostgreSQL)]
    Express2 --> Pool --> PG
  end
```

---

## 15. Related doc

- [VAHAN360_TECHNICAL_AUDIT.md](./VAHAN360_TECHNICAL_AUDIT.md) — Section 7 (database audit), Section 2 (stack).
