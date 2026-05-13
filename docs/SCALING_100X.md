# Scaling toward ~100× load (practical notes)

Operational bullets aligned with this repo’s shape (Postgres + Prisma multi-schema, BullMQ on Redis, `worker-ingest`, optional Playwright). Yeh **guidance** hai — har point ko apne traffic / SLO ke hisaab se measure karke adopt karo.

---

## Database

- **Partition / time-series friendly tables:** `ingest.job_events` jaisi append-heavy tables ke liye **range partitioning** (e.g. by month on `occurred_at`) consider karo taake retention drop aur vacuum cheap rahein.
- **Read replicas:** dashboards / reporting / heavy `GET` lists ko **replica** pe point karo; writes `ingest` master par; replica lag ko UI mein dikhao.
- **Connection pools:** API aur worker dono ke Prisma pool sizes alag tune karo; PgBouncer / transaction pooling agar connection storm ho.
- **Hot indexes:** tail reads (`job_id`, `occurred_at`) already important — naye query paths add karte waqt **EXPLAIN** se verify karo.

## Queues & workers

- **Queue sharding:** ek Redis par sab queues = bottleneck; **alag Redis** per tenant/region ya **queue name prefixes** + dedicated worker fleets se blast radius kam karo.
- **HPA on queue depth:** Kubernetes mein CPU-only HPA se zyada behtar: **KEDA** (Redis list length / BullMQ metrics) ya custom metrics exporter se **waiting + active** depth par scale.
- **Concurrency:** `INGEST_WORKER_CONCURRENCY` / `INGEST_CHILD_CONCURRENCY` ko CPU+IO ke mutabiq; Playwright wale pods ko **alag node pool** + lower concurrency.
- **DLQ discipline:** DLQ depth alerts + replay caps (`INGEST_RETRY_MAX_REPLAYS`, admin replay) — scaling ke saath misconfiguration ka nuksan bhi scale hota hai.

## Redis

- **Redis Cluster / managed Redis:** high throughput + HA; BullMQ ke saath **cluster limitations** (hash tags, latency) docs se match karo before cutover.
- **Memory & eviction:** queue payloads slim rakho; eviction policy **volatile-lru** vs **noeviction** — data loss vs OOM tradeoff clear rakho.

## Browser / Playwright

- **Dedicated node pools:** GPU/high-mem labels, **taints** taake API pods par browser workload na chadh jaye.
- **Browser pool:** `packages/browser-pool` skeleton ko real pool + max contexts + idle timeout ke saath wire karo; **per-tenant concurrency caps**.

## Edge & API

- **Rate limits:** Express par scrape enqueue limits + optional **global** cap (`RATE_LIMIT_GLOBAL_*`); nginx `limit_req` extra shield.
- **SSE / long requests:** ingress/proxy **timeouts** (`proxy_read_timeout` style) scrape streams ke liye explicitly bump karo warna silent disconnects.

## Observability & cost

- **Metrics:** `/metrics` (API) + worker `WORKER_METRICS_PORT` — ** cardinality** low rakho; recording rules for SLOs.
- **Tracing:** `OTEL_ENABLED` + sampling in prod (100% trace often too expensive).
- **Cost controls:** right-size replicas, **spot** for fault-tolerant workers with interruption tolerance, autoscaling min/max guardrails, **object storage** lifecycle for raw captures (jab implement ho).

## Security at scale

- **Nest /metrics exposure:** Nest ko public mat kholna jab tak auth/mTLS na ho; Express `API_V2_PROXY_ENABLED` pattern mein internal `NEST_INTERNAL_URL` use karo.
- **Admin replay token:** `ADMIN_QUEUE_TOKEN` rotate karne ka runbook — ek leak se poori queue replay ho sakti hai.
