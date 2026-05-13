# KEDA (queue-depth autoscaler)

Vahan360 ships Helm templates under `templates/keda-*.yaml` gated by **`keda.enabled`** in `values.yaml`.

## Cluster prerequisites

1. Install **[KEDA](https://keda.sh/)** on the cluster so `ScaledObject` and `TriggerAuthentication` CRDs exist (`kubectl get crd scaledobjects.keda.sh`).
2. **Do not** enable classic CPU/`HorizontalPodAutoscaler` on the same workload if it fights KEDA replicas — pick one autoscaler strategy.
3. **Redis address is mandatory** when KEDA is on: set **`keda.redis.address`** to your BullMQ Redis host/port (often an external Elasticache/Azure Cache — not the optional in-chart Redis stub). BullMQ list length trigger uses keys like `bull:<queue>:wait` (queue names from `@vahan360/contracts`).
4. Align **`keda.worker.queueName`** / **`workerRetry`** with Helm `config.INGEST_QUEUE_*` overrides if you renamed queues.

## Values quick reference

See `deploy/helm/vahan360/values.yaml` block **`keda:`** — notably `redis.address`, TLS, and password Secret wiring for `TriggerAuthentication`.
