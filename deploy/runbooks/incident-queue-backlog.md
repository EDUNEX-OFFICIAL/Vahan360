# Incident: Redis down, queue backlog, browser pool pressure — ops note

**Scope:** BullMQ ingest (`scrape-ingest`, child, retry), Redis-backed queues, optional distributed browser-manager.

## Redis unavailable

1. **Confirm:** `kubectl get pods` (worker / worker-retry failing readiness or crash-loop on Redis), Redis Service/StatefulSet, network policies.
2. **Mitigate:** restore Redis (managed failover or Bitnami pod), or point workers to standby `REDIS_URL` / `BULLMQ_REDIS_URL` via secret + rollout restart. No safe hot-swap without coordination — expect in-flight jobs to stall until Redis is back.
3. **Comms:** page on-call if **Alertmanager** routes fire (see `deploy/prometheus/alertmanager.yml` placeholders: wire `ops_webhook_url` / `critical_webhook_url` for your env).

## Queue backlog spikes

1. **Observe:** Grafana dashboard `deploy/grafana/dashboards/vahan360-queue-depth.json` (import to your Grafana; tune datasources). Cross-check `system.queue_metrics` in DB if worker metrics writes are on.
2. **Scale:** CPU HPA (`deploy/helm/vahan360/templates/hpa.yaml`) **or** KEDA Redis scaler on `bull:<queueName>:wait` (`deploy/helm/vahan360/templates/keda-scaledobject-worker*.yaml`, `values.keda.*`). Requires **KEDA CRD** on cluster (`kubectl get crd scaledobjects.keda.sh`).
3. **Tune:** `worker.replicaCount`, `INGEST_CHILD_CONCURRENCY`, KEDA `listLength` thresholds — avoid Redis overload.

## Browser pool exhaustion (distributed browser-manager)

1. **Signals:** Playwright smoke failures, `browser-manager` high `pool.waitingRequests` (health JSON), 503/401 on lease `/v1/context/*` (check `BROWSER_MANAGER_TOKEN` + `X-Tenant-Id` / JWT).
2. **Actions:** scale `worker` concurrency thoughtfully, enlarge `BROWSER_POOL_MAX_*` with memory caps, prefer **`browserManager.replicaCount=1`** for a coherent pool OR raise replicas **with** Helm `browserManager.service.sessionAffinityEnabled=true` (ClientIP stickiness toward one pod — best-effort). True cross-replica pooling needs a Redis lease registry (**not shipped**).

## Replay failed jobs safely

1. **DLQ → master/child:** use documented admin replay (`POST /api/v1/admin/queues/retry-replay` + `ADMIN_QUEUE_REPLAY_ENABLED`) or Nest failed-job replay (audit-log path) — see `docs/ENTERPRISE_COMPLETION_CHECKLIST.md` §4 and `FailedJobReplayService`.
2. **Rules:** increment `replayAttempts` / respect max replays; verify payload `target` / `dlqMeta.sourceQueue` for correct queue; never double-charge idempotent keys without checking Bull job id.

## References (placeholders)

- **Grafana:** import committed JSON under `deploy/grafana/dashboards/`; set Prometheus datasource UID in dashboards.
- **Alertmanager:** `deploy/prometheus/alertmanager.yml` + env-specific secrets for receivers (`global.smtp_xxx`, webhooks).
