# Runbook: Backup & Restore — Postgres + Redis (Vahan360)

> Maintained by: on-call SRE  
> Last updated: 2026-05-14  
> Related: [`RUNBOOK_INCIDENTS.md`](./RUNBOOK_INCIDENTS.md), [`SCALING_100X.md`](./SCALING_100X.md)

---

## Scope

This runbook covers **repo-level guidance** for Postgres (primary + ingest schemas) and Redis (BullMQ) backup, verification, and restore procedures. Concrete cron schedules and credentials are injected per environment via Helm values / SealedSecrets.

---

## RPO / RTO Targets

| Environment | RPO (max data loss) | RTO (max restore time) |
|-------------|---------------------|------------------------|
| Production  | 1 hour              | 4 hours                |
| Staging     | 24 hours            | 8 hours                |
| Dev/local   | Best-effort         | Best-effort            |

Review and tighten these targets with the product owner for each major release.

---

## 1. Postgres Backup

### 1a. Continuous WAL archiving (recommended for prod)

Enable `archive_mode = on` and `archive_command` in `postgresql.conf`, pointing to object storage (S3 / GCS):

```bash
# postgresql.conf
archive_mode = on
archive_command = 'aws s3 cp %p s3://vahan360-pg-wal/$f'
restore_command = 'aws s3 cp s3://vahan360-pg-wal/%f %p'
```

Use **pg_basebackup** weekly for a full base backup alongside WAL streaming.

### 1b. Logical snapshot backup (simpler, acceptable for staging)

```bash
# Full logical dump — run from a pod or jump host with access to DATABASE_URL
PGPASSWORD=$POSTGRES_PASSWORD pg_dump \
  --host=$POSTGRES_HOST \
  --port=5432 \
  --username=$POSTGRES_USER \
  --dbname=$POSTGRES_DB \
  --format=custom \
  --compress=9 \
  --file="/backups/vahan360-$(date +%Y%m%dT%H%M%S).pgdump"
```

Upload to object storage immediately after:

```bash
aws s3 cp /backups/vahan360-*.pgdump s3://vahan360-backups/postgres/
```

### 1c. Automated schedule

Deploy a Kubernetes `CronJob` in the `vahan360` namespace:

```yaml
# deploy/k8s/cronjob-pg-backup.yaml (template — fill creds via SealedSecrets)
apiVersion: batch/v1
kind: CronJob
metadata:
  name: vahan360-pg-backup
  namespace: vahan360
spec:
  schedule: "0 2 * * *"   # 02:00 UTC daily
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: pg-backup
              image: postgres:16-alpine
              command:
                - sh
                - -c
                - |
                  pg_dump $DATABASE_URL -Fc -Z9 \
                    -f /tmp/dump.pgdump && \
                  aws s3 cp /tmp/dump.pgdump \
                    s3://vahan360-backups/postgres/$(date +%Y%m%dT%H%M%S).pgdump
              envFrom:
                - secretRef:
                    name: vahan360-pg-backup-secrets
```

### 1d. Backup verification (weekly)

```bash
# Restore to a throwaway DB and run schema smoke test
pg_restore --dbname=postgres://...throwaway... /backups/latest.pgdump
psql postgres://...throwaway... -c "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','ingest','processed','system');"
```

---

## 2. Redis Backup

BullMQ state lives in Redis. Redis is **not the primary data store** for Vahan360 — all terminal job state is persisted to Postgres (`system.queue_metrics`, `ingest.job_events`). Redis data loss results in in-flight job loss, NOT data loss of scraped results.

### 2a. RDB snapshots (recommended)

Enable in `redis.conf` (or pass to Redis chart):

```
save 900 1
save 300 10
save 60 10000
dir /data
dbfilename dump.rdb
```

Copy the `dump.rdb` to object storage on a schedule:

```bash
redis-cli --no-auth-warning -a $REDIS_PASSWORD BGSAVE
sleep 2
aws s3 cp /data/dump.rdb s3://vahan360-backups/redis/dump-$(date +%Y%m%dT%H%M%S).rdb
```

### 2b. AOF (optional, tighter RPO)

```
appendonly yes
appendfsync everysec
```

### 2c. Recovery impact

If Redis is lost with no backup, in-flight BullMQ jobs are gone. Recovery path:

1. Start fresh Redis instance.
2. Any jobs in `WAITING` / `DELAYED` state are irrecoverable from Redis alone.
3. Re-enqueue from `ingest.scrape_jobs` rows with `status = 'queued'` using the DLQ replay API:

```bash
curl -X POST /api/v1/admin/queues/retry-replay \
  -H "X-Admin-Token: $ADMIN_QUEUE_TOKEN" \
  -H "Cookie: spybot_access=..." \
  -d '{"kind":"khanan_date_range","vehicleNumber":"..."}'
```

---

## 3. Multi-schema restore procedure

Vahan360 uses four Postgres schemas: `public`, `ingest`, `processed`, `system`.

```bash
# Full restore from logical dump
pg_restore \
  --host=$POSTGRES_HOST \
  --username=$POSTGRES_USER \
  --dbname=$POSTGRES_DB \
  --no-owner \
  --no-privileges \
  --clean \
  /backups/vahan360-TIMESTAMP.pgdump

# Re-run Prisma migrations to ensure schema state is current
pnpm --filter @vahan360/api-express run prisma:push
pnpm --filter @vahan360/db run db:push
```

---

## 4. Point-in-time recovery (PITR)

Requires WAL archiving (§1a). Recover to a specific timestamp:

```bash
# postgresql.conf (recovery target)
recovery_target_time = '2026-05-14 03:00:00'
recovery_target_action = 'promote'
```

Place `recovery.signal` file in data directory and restart Postgres.

---

## 5. Retention policy

| Backup type          | Minimum retention |
|----------------------|-------------------|
| Daily logical dumps  | 30 days           |
| WAL segments         | 7 days            |
| Weekly base backups  | 90 days           |
| Redis RDB snapshots  | 7 days            |

Implement S3 lifecycle rules or equivalent to auto-expire old backups.

---

## 6. Checklist before a major deploy

- [ ] Trigger manual `pg_dump` and verify upload to object storage.
- [ ] Confirm latest Redis RDB snapshot is < 24 h old.
- [ ] Run schema smoke test against backup copy.
- [ ] Document the backup timestamp in the deploy ticket.

---

## See also

- [`RUNBOOK_INCIDENTS.md`](./RUNBOOK_INCIDENTS.md) — DLQ flood, Redis down, Postgres failover playbooks.
- [`SCALING_100X.md`](./SCALING_100X.md) — PgBouncer + read replica guidance.
- [`MIGRATION_AND_CLEANUP.md`](./MIGRATION_AND_CLEANUP.md) — DB migration sequence.
