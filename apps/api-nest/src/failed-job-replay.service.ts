import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  INGEST_BULL_QUEUE_DEFAULTS,
  SCRAPE_JOB_KINDS,
  isIngestChildJobType,
} from '@vahan360/contracts';
import { AuditLogService } from './audit-log.service';
import { FailedJobService, type FailedJobListRow } from './failed-job.service';

const MAX_REPLAY_PAYLOAD_BYTES = 64 * 1024;

const SENSITIVE_KEY_RE =
  /secret|password|token|apikey|authorization|cookie|credential|bearer|private[_-]?key|set[-_]?cookie|x[-_]api[-_]key/i;

const DEFAULT_MASTER_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
};

function ingestRedisUrl(): string | undefined {
  const raw =
    process.env.BULLMQ_REDIS_URL?.trim() || process.env.REDIS_URL?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function resolvedQueueNames(): {
  master: string;
  child: string;
  dlq: string;
  retry: string;
} {
  return {
    master:
      process.env.INGEST_QUEUE_NAME?.trim() ||
      INGEST_BULL_QUEUE_DEFAULTS.master,
    child:
      process.env.INGEST_CHILD_QUEUE_NAME?.trim() ||
      INGEST_BULL_QUEUE_DEFAULTS.child,
    dlq:
      process.env.INGEST_DLQ_QUEUE_NAME?.trim() ||
      INGEST_BULL_QUEUE_DEFAULTS.dlq,
    retry:
      process.env.INGEST_RETRY_QUEUE_NAME?.trim() ||
      INGEST_BULL_QUEUE_DEFAULTS.retry,
  };
}

type IngestQueueRole = 'master' | 'child' | 'retry' | 'dlq' | 'unknown';

function classifyFailedQueue(
  queueName: string,
  names: ReturnType<typeof resolvedQueueNames>,
): IngestQueueRole {
  if (queueName === names.master) return 'master';
  if (queueName === names.child) return 'child';
  if (queueName === names.retry) return 'retry';
  if (queueName === names.dlq) return 'dlq';
  return 'unknown';
}

function isValidKind(kind: unknown): kind is (typeof SCRAPE_JOB_KINDS)[number] {
  return (
    typeof kind === 'string' &&
    (SCRAPE_JOB_KINDS as readonly string[]).includes(kind)
  );
}

function jsonUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function assertUnderPayloadCap(label: string, value: unknown): void {
  const n = jsonUtf8Bytes(value);
  if (n > MAX_REPLAY_PAYLOAD_BYTES) {
    throw new BadRequestException({
      error: 'payload_too_large',
      label,
      bytes: n,
      maxBytes: MAX_REPLAY_PAYLOAD_BYTES,
    });
  }
}

function stripSensitiveDeep(
  input: unknown,
  depth = 0,
): Record<string, unknown> {
  if (depth > 8 || input == null || typeof input !== 'object') {
    return {};
  }
  if (Array.isArray(input)) {
    return {};
  }
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripSensitiveDeep(v, depth + 1);
    } else {
      out[k] = v as unknown;
    }
  }
  return out;
}

function payloadRecord(row: FailedJobListRow): Record<string, unknown> {
  if (row.payload != null && typeof row.payload === 'object' && !Array.isArray(row.payload)) {
    return { ...(row.payload as Record<string, unknown>) };
  }
  return {};
}

@Injectable()
export class FailedJobReplayService implements OnModuleDestroy {
  private redis: IORedis | null = null;
  private readonly queueCache = new Map<string, Queue>();

  constructor(
    private readonly failedJobService: FailedJobService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.queueCache.values()].map((q) => q.close().catch(() => undefined)),
    );
    this.queueCache.clear();
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
    }
  }

  private connection(url: string): IORedis {
    if (!this.redis) {
      this.redis = new IORedis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    }
    return this.redis;
  }

  private queueForName(queueName: string, redisUrl: string): Queue {
    let q = this.queueCache.get(queueName);
    if (!q) {
      q = new Queue(queueName, {
        connection: this.connection(redisUrl),
        defaultJobOptions: DEFAULT_MASTER_JOB_OPTIONS,
      });
      this.queueCache.set(queueName, q);
    }
    return q;
  }

  async replay(failedJobId: string, tenantId: string): Promise<{
    status: 'ok';
    replayed: true;
    bullJobId?: string;
    queueName: string;
  }> {
    if (!this.failedJobService.ingestDbConfigured()) {
      throw new ServiceUnavailableException({
        error: 'ingest_db_not_configured',
        detail:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load failed jobs.',
      });
    }

    const redisUrl = ingestRedisUrl();
    if (!redisUrl) {
      throw new ServiceUnavailableException({
        error: 'redis_not_configured',
        detail: 'Set REDIS_URL or BULLMQ_REDIS_URL to replay jobs.',
      });
    }

    const row = await this.failedJobService.getById(failedJobId, tenantId);
    if (!row) {
      throw new NotFoundException({ error: 'failed_job_not_found', id: failedJobId });
    }

    const names = resolvedQueueNames();
    const role = classifyFailedQueue(row.queueName, names);
    if (role === 'unknown' || role === 'dlq') {
      throw new BadRequestException({
        error: 'queue_not_supported',
        queueName: row.queueName,
        detail:
          'Replay supports ingest master, child, and retry queues only (matching env-resolved queue names).',
      });
    }

    const scrapeJobId = row.scrapeJobId?.trim();
    const correlationId = row.correlationId?.trim();
    if (!scrapeJobId) {
      throw new BadRequestException({
        error: 'missing_scrape_job_id',
        detail: 'FailedJob.scrapeJobId is required for replay.',
      });
    }
    if (!correlationId) {
      throw new BadRequestException({
        error: 'missing_correlation_id',
        detail: 'FailedJob.correlationId is required for replay.',
      });
    }

    const basePayload = stripSensitiveDeep({
      ...payloadRecord(row),
      scrapeJobId,
      correlationId,
    });
    assertUnderPayloadCap('sanitized_row_payload', basePayload);

    const kind = basePayload.kind;
    if (!isValidKind(kind)) {
      throw new BadRequestException({
        error: 'invalid_or_missing_kind',
        detail:
          'payload.kind must be one of SCRAPE_JOB_KINDS (mirrored from terminal failure).',
      });
    }

    const q = this.queueForName(row.queueName, redisUrl);
    let bullJobId: string | undefined;

    try {
      if (role === 'master') {
        const data = stripSensitiveDeep({
          scrapeJobId,
          kind,
          correlationId,
          replayAttempts: 0,
        });
        assertUnderPayloadCap('master_job_data', data);
        const job = await q.add('master', data, { jobId: scrapeJobId });
        bullJobId = job.id != null ? String(job.id) : undefined;
      } else if (role === 'child') {
        const stepRaw = basePayload.step;
        if (typeof stepRaw !== 'string' || !stepRaw.trim()) {
          throw new BadRequestException({
            error: 'missing_child_step',
            detail: 'Child queue replay requires payload.step from the failed job row.',
          });
        }
        const step = stepRaw.trim();
        const typeHint =
          typeof basePayload.type === 'string' &&
          isIngestChildJobType(basePayload.type)
            ? basePayload.type
            : undefined;
        const data: Record<string, unknown> = {
          scrapeJobId,
          kind,
          correlationId,
          step,
          replayAttempts: 0,
        };
        if (typeHint) data.type = typeHint;
        const cleaned = stripSensitiveDeep(data);
        assertUnderPayloadCap('child_job_data', cleaned);
        const job = await q.add('child', cleaned, {
          jobId: `${scrapeJobId}:${step}`,
        });
        bullJobId = job.id != null ? String(job.id) : undefined;
      } else {
        const stepRaw = basePayload.step;
        const step =
          typeof stepRaw === 'string' && stepRaw.trim() ? stepRaw.trim() : '';
        const replayData: Record<string, unknown> = {
          scrapeJobId,
          kind,
          correlationId,
          replayAttempts: 0,
        };
        if (step) {
          replayData.step = step;
          replayData.target = 'child';
          replayData.dlqMeta = { sourceQueue: names.child };
          if (
            typeof basePayload.type === 'string' &&
            isIngestChildJobType(basePayload.type)
          ) {
            replayData.type = basePayload.type;
          }
        } else {
          replayData.target = 'master';
        }
        const cleaned = stripSensitiveDeep(replayData);
        assertUnderPayloadCap('retry_job_data', cleaned);
        const job = await q.add('retry', cleaned, {
          jobId: `replay:failed-job:${row.id}:${Date.now()}`,
        });
        bullJobId = job.id != null ? String(job.id) : undefined;
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists|duplicate job id/i.test(msg)) {
        throw new ConflictException({
          error: 'bull_job_id_conflict',
          detail: msg,
          queueName: row.queueName,
        });
      }
      throw new ServiceUnavailableException({
        error: 'bullmq_enqueue_failed',
        detail: msg,
        queueName: row.queueName,
      });
    }

    void this.auditLogService.writeEntry({
      action: 'failed_job.replay',
      resource: row.id,
      payload: {
        queueName: row.queueName,
        bullJobId: bullJobId ?? null,
        priorBullJobId: row.bullJobId,
      },
    });

    return {
      status: 'ok',
      replayed: true,
      bullJobId,
      queueName: row.queueName,
    };
  }
}
