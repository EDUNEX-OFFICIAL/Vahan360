# Runbook: Incident Playbooks (Vahan360)

> Maintained by: on-call SRE  
> Last updated: 2026-05-14  
> Related: [`RUNBOOK_BACKUP_RESTORE.md`](./RUNBOOK_BACKUP_RESTORE.md), [`SCALING_100X.md`](./SCALING_100X.md)

---

## Playbook index

| # | Incident | Severity | MTTD target |
|---|----------|----------|-------------|
| 1 | DLQ flood (>50 failed jobs) | P2 | < 5 min (Prometheus alert) |
| 2 | Redis down / unreachable | P1 | < 2 min (health check) |
| 3 | Postgres primary failover | P1 | < 5 min (health check) |
| 4 | Worker heartbeat stale | P2 | < 10 min (alert) |
| 5 | High scrape error rate (>20% in 5 min) | P2 | < 5 min (alert) |
| 6 | API response latency spike (p95 > 2 s) | P3 | < 10 min (Grafana) |

---

## 1. DLQ flood — more than 50 jobs in `scrape-ingest-dlq`

**Triggered by:** Prometheus alert `IngestDLQDepthHigh` (see `deploy/prometheus/rules/vahan360-ingest.rules.yml`).

**Triage:**

```bash
# Check DLQ depth via health endpoint
curl -s /health | jq '.queueDepthByName'

# Or via Bull Board UI at /admin/queues (requires ADMIN session)
```

**Common causes & fixes:**

| Cause | Fix |
|-------|-----|
| Upstream VAHAN portal HTML changed | Update parser stub in `worker-ingest/src/persistJobArtifacts.js`; redeploy worker. |
| Redis OOM causing job loss before persist | Scale Redis, check `maxmemory-policy`. See §2. |
| Bug in worker code crashing all jobs | Check worker logs; roll back deployment. |
| Rate-limit from upstream portal | Increase `SCRAPE_INTERVAL_MS`, reduce concurrency. |

**Replay DLQ jobs (manual):**

```bash
# Requires ADMIN JWT cookie + ADMIN_QUEUE_REPLAY_ENABLED=true + ADMIN_QUEUE_TOKEN set
curl -X POST /api/v1/admin/queues/retry-replay \
  -H "X-Admin-Token: $ADMIN_QUEUE_TOKEN" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Cookie: spybot_access=$ACCESS_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"<job-id>"}'
```

Alternatively, replay from the Nest replay endpoint (`POST /system/failed-jobs/:id/replay`) which also writes an audit log entry.

**Escalate if:** DLQ depth still growing after 30 min; portal appears down.

---

## 2. Redis down / unreachable

**Triggered by:** `/health` endpoint returns `redis: false`; BullMQ workers start logging `ECONNREFUSED`.

**Immediate impact:** New scrape jobs cannot be enqueued; in-flight workers stall; Bull Board unavailable.

**Steps:**

1. Confirm Redis pod / service status:
   ```bash
   kubectl get pods -n vahan360 -l app=redis
   kubectl logs -n vahan360 deployment/redis --tail=50
   ```

2. If Redis pod is crashing (OOM): increase memory limits in `values.yaml` and redeploy.

3. If network partition: verify Service + NetworkPolicy allow worker → Redis on port 6379.

4. If Redis data is corrupted: restore from RDB snapshot (see [`RUNBOOK_BACKUP_RESTORE.md`](./RUNBOOK_BACKUP_RESTORE.md) §2).

5. After Redis recovers, BullMQ workers reconnect automatically (exponential backoff). Monitor `/health` until `redis: true`.

6. Re-enqueue any lost in-flight jobs from `ingest.scrape_jobs` where `status = 'queued'` (see Backup Runbook §2c).

**Escalate if:** Redis cannot restart within 15 min; data dir is corrupt.

---

## 3. Postgres primary failover

**Triggered by:** `/api/health/pg` returns 503; Prisma logs `P1001` / `ECONNREFUSED`.

**Immediate impact:** All Express + Nest API writes fail; reads fail if read replica is not configured.

**Steps:**

1. Confirm DB pod / managed DB status:
   ```bash
   kubectl get pods -n vahan360 -l app=postgres
   # Or check managed DB console (RDS / Cloud SQL)
   ```

2. If running self-managed Postgres with streaming replication:
   - Promote standby: `pg_ctl promote -D $PGDATA` on standby pod.
   - Update `DATABASE_URL` / `INGEST_DATABASE_URL` secrets to point to new primary.
   - Rolling restart API pods to pick up new env.

3. If using managed DB (RDS Multi-AZ): failover is automatic; wait up to 60 s for DNS propagation.

4. After reconnection, verify data integrity:
   ```bash
   psql $DATABASE_URL -c "SELECT count(*) FROM public.users;"
   psql $INGEST_DATABASE_URL -c "SELECT count(*) FROM ingest.scrape_jobs;"
   ```

5. Check for any Prisma migration drift:
   ```bash
   pnpm --filter @vahan360/db run db:validate
   ```

**Escalate if:** Failover not complete within RPO window (1 h prod); data inconsistency detected post-failover.

---

## 4. Worker heartbeat stale

**Triggered by:** `/health` returns `workerFresh: false`; Prometheus alert (if wired).

**Triage:**

```bash
kubectl get pods -n vahan360 -l app=worker-ingest
kubectl logs -n vahan360 deployment/worker-ingest --tail=100
```

**Common causes:**

| Cause | Fix |
|-------|-----|
| Worker pod OOMKilled | Increase memory limits; check for Playwright leaks (`BROWSER_POOL_MAX`). |
| Redis disconnected | See §2. |
| Worker stuck processing single job (portal hang) | Kill stale browser context; reduce `SCRAPE_TIMEOUT_MS`. |
| Node.js unhandled rejection crashing process | Check logs; add global handler if missing. |

**Recovery:** Worker auto-restarts via Kubernetes `restartPolicy`. If stuck: `kubectl rollout restart deployment/worker-ingest -n vahan360`.

---

## 5. High scrape error rate

**Triggered by:** Prometheus alert `IngestErrorRateHigh`; DLQ growing; user reports.

**Steps:**

1. Check error types in worker logs — distinguish between portal errors vs. code errors.
2. Identify which `SCRAPE_JOB_KINDS` are failing (`kind` field in job data).
3. If portal is down: halt new enqueues via `INGEST_DLQ_ENABLED=false` temporarily or via Bull Board pause.
4. If rate-limited by upstream: reduce `RATE_LIMIT_SCRAPE_MAX` and increase `SCRAPE_INTERVAL_MS`.
5. After fix, resume jobs; replay from DLQ if needed (§1).

---

## 6. API latency spike (p95 > 2 s)

**Triggered by:** Grafana `vahan360-http-api` dashboard; user reports slowness.

**Steps:**

1. Check Postgres query times — look for slow queries via `pg_stat_activity` or `pg_stat_statements`.
2. Check Redis latency — `/health` exposes `redisLatencyMs`.
3. Check CPU / memory on API pods: `kubectl top pods -n vahan360`.
4. If Postgres is slow: confirm indexes exist (see `packages/db/prisma/schema.prisma` index annotations); consider enabling PgBouncer (see [`SCALING_100X.md`](./SCALING_100X.md)).
5. If single endpoint is slow: profile with OTEL traces in Jaeger (compose profile `obs-otel`).
6. Quick relief: horizontal scale API pods via HPA or manual replica bump.

---

## Alertmanager routing (reference)

See `deploy/prometheus/alertmanager.yml` for severity-based routing. Fill in:
- `slack_api_url` for `#alerts-p2` / `#alerts-p1` channels.
- `pagerduty_url` for P1 on-call escalation.

Wire Prometheus to Alertmanager:
```bash
--alertmanager.url=http://alertmanager:9093
```

---

## Post-incident checklist

- [ ] Timeline documented in incident ticket.
- [ ] Root cause identified and linked to code/config fix.
- [ ] Runbook updated if steps were wrong or missing.
- [ ] Alerting threshold adjusted if alert fired too late / too early.
- [ ] Any data gaps from downtime assessed and re-ingested if feasible.

---

## See also

- [`RUNBOOK_BACKUP_RESTORE.md`](./RUNBOOK_BACKUP_RESTORE.md) — backup, restore, PITR.
- [`SCALING_100X.md`](./SCALING_100X.md) — horizontal scaling, PgBouncer, KEDA guidance.
- [`SECURITY_ROADMAP_HTTPONLY.md`](./SECURITY_ROADMAP_HTTPONLY.md) — auth security phases.
